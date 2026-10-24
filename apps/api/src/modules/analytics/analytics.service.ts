import { Inject, Injectable, Logger } from '@nestjs/common'
import type Redis from 'ioredis'
import { Role } from '@studenthub/shared-types'
import { PrismaService } from '../../common/prisma/prisma.service'
import { REDIS_CLIENT } from '../../common/redis/redis.module'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

// Доля не-пропусков: (всего − отсутствовал) / всего, в процентах.
function rateOf(counts: { total: number; absent: number }): number {
  return counts.total === 0 ? 0 : Math.round(((counts.total - counts.absent) / counts.total) * 100)
}

// Потолок на список групп факультета (BACKEND_RULES §7.2); остальные агрегаты
// уже читаются с явными take.
const FACULTY_GROUPS_LIMIT = 500
// Потолок на список студентов одной группы (drill-down посещаемости).
const GROUP_STUDENTS_LIMIT = 500

// Порог «требует внимания» по посещаемости, проценты. Общий с дашбордом вуза
// (UniversityAnalyticsService.overview): одна группа не должна быть в зоне риска у декана
// и вне её у админа вуза.
export const AT_RISK_THRESHOLD = 60
const GRADE_RISK_THRESHOLD = 50

// Причина попадания студента в зону риска — всегда объективна и с числовым значением
// (никаких непрозрачных авто-решений). value интерпретируется по kind (проценты/штуки).
interface RiskReason {
  kind: 'LOW_ATTENDANCE' | 'OVERDUE_ASSIGNMENTS' | 'LOW_GRADES'
  value: number
}

/**
 * Кэш обзора факультета и drill-down группы — тот же подход, что у статистики вуза
 * (UniversityService.getStats) и сводки вуза: Redis, TTL 5 мин, сбой Redis — расчёт
 * напрямую. Обзор открывают с главной декана при каждом заходе, а считается он по всей
 * истории посещаемости факультета.
 *
 * Ключ — по уже ПРОВЕРЕННОЙ области: факультет или группа, к которым смотрящий допущен.
 * Проверка доступа идёт до чтения кэша, поэтому общий ключ для декана и админа вуза
 * безопасен: оба видят ровно одно и то же. Других параметров у этих сводок нет.
 */
const CACHE_TTL_SECONDS = 300
export const facultyOverviewKey = (facultyId: string): string =>
  `analytics:faculty:overview:${facultyId}`
export const groupAttendanceKey = (groupId: string): string =>
  `analytics:group:attendance:${groupId}`

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Сброс кэша при смене состава факультета — те же события, на которых сбрасывается
   * статистика вуза: группа создана или удалена (GroupService). Отметки посещаемости кэш
   * не сбрасывают, как и у сводки вуза: их ставят пачками по паре, и пересчёт обзора на
   * каждую отметку свёл бы кэш на нет — свежесть держит TTL.
   */
  async invalidateFaculty(facultyId: string, groupId?: string): Promise<void> {
    const keys = [facultyOverviewKey(facultyId)]
    if (groupId) keys.push(groupAttendanceKey(groupId))
    try {
      await this.redis.del(...keys)
    } catch (error) {
      this.logger.warn(
        `Не удалось сбросить кэш аналитики факультета ${facultyId}: ${(error as Error).message}`,
      )
    }
  }

  private async cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
    try {
      const hit = await this.redis.get(key)
      if (hit) return JSON.parse(hit) as T
    } catch {
      // Redis недоступен — считаем напрямую: обзор без кэша лучше, чем без обзора.
    }
    const value = await compute()
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS)
    } catch {
      // см. выше
    }
    return value
  }

  // ── Агрегаты считает база (Ф13.6) ──────────────────────────────────────────
  //
  // Эти запросы были обычными findMany с потолком в 20–200 тысяч строк: вся
  // посещаемость факультета, все сдачи и все оценки приезжали в Node и сворачивались
  // там в Map'ы. На стенде одного вуза (52 200 отметок, 1450 студентов) обзор факультета
  // отвечал 266 мс против 18 мс у самого тяжёлого из остальных экранов, и рос линейно
  // с числом занятий: у вуза за учебный год это миллионы строк, то есть секунды и
  // мегабайты в памяти процесса на каждый заход декана.
  //
  // Теперь сворачивает Postgres — наружу приходит по строке на группу или на студента.
  //
  // Raw SQL, а не `groupBy` Prisma: группировать нужно по полю СВЯЗАННОЙ таблицы
  // (`pairs.group_id`, `assignments.course_id`), а Prisma группирует только по колонкам
  // самой модели. Значения подставляются плейсхолдерами, конкатенации в SQL нет (§14.4).
  //
  // `count()` в Postgres возвращает bigint, и драйвер отдаёт его как BigInt — наружу
  // уходит обычное число, иначе JSON.stringify падает на сериализации.

  /** Посещаемость факультета, свёрнутая по группам. */
  private async attendanceByGroup(
    facultyId: string,
  ): Promise<{ groupId: string; total: number; absent: number }[]> {
    const rows = await this.prisma.$queryRaw<{ groupId: string; total: bigint; absent: bigint }[]>`
      SELECT p.group_id AS "groupId",
             count(*) AS total,
             count(*) FILTER (WHERE a.status = 'ABSENT') AS absent
      FROM attendance a
      JOIN pairs p ON p.id = a.pair_id
      JOIN groups g ON g.id = p.group_id
      WHERE g.faculty_id = ${facultyId}
      GROUP BY p.group_id`
    return rows.map((r) => ({
      groupId: r.groupId,
      total: Number(r.total),
      absent: Number(r.absent),
    }))
  }

  /** Посещаемость факультета, свёрнутая по студентам. */
  private async attendanceByStudent(
    facultyId: string,
  ): Promise<{ studentId: string; total: number; absent: number }[]> {
    const rows = await this.prisma.$queryRaw<
      { studentId: string; total: bigint; absent: bigint }[]
    >`
      SELECT a.student_id AS "studentId",
             count(*) AS total,
             count(*) FILTER (WHERE a.status = 'ABSENT') AS absent
      FROM attendance a
      JOIN pairs p ON p.id = a.pair_id
      JOIN groups g ON g.id = p.group_id
      WHERE g.faculty_id = ${facultyId}
      GROUP BY a.student_id`
    return rows.map((r) => ({
      studentId: r.studentId,
      total: Number(r.total),
      absent: Number(r.absent),
    }))
  }

  /**
   * Посещаемость группы, свёрнутая по студентам, — для drill-down декана. Строк столько,
   * сколько студентов когда-либо отмечали в парах группы, а не по строке на отметку.
   */
  private async attendanceByStudentInGroup(
    groupId: string,
  ): Promise<{ studentId: string; total: number; absent: number }[]> {
    const rows = await this.prisma.$queryRaw<
      { studentId: string; total: bigint; absent: bigint }[]
    >`
      SELECT a.student_id AS "studentId",
             count(*) AS total,
             count(*) FILTER (WHERE a.status = 'ABSENT') AS absent
      FROM attendance a
      JOIN pairs p ON p.id = a.pair_id
      WHERE p.group_id = ${groupId}
      GROUP BY a.student_id`
    return rows.map((r) => ({
      studentId: r.studentId,
      total: Number(r.total),
      absent: Number(r.absent),
    }))
  }

  /**
   * Сколько заданий с истёкшим сроком студент сдал. Просрочку вызывающий считает
   * вычитанием из числа заданий его группы — множество идентификаторов для этого не нужно.
   */
  private async doneAssignmentsByStudent(
    facultyId: string,
  ): Promise<{ studentId: string; done: number }[]> {
    const rows = await this.prisma.$queryRaw<{ studentId: string; done: bigint }[]>`
      SELECT s.student_id AS "studentId", count(DISTINCT s.assignment_id) AS done
      FROM submissions s
      JOIN assignments asg ON asg.id = s.assignment_id
      JOIN courses c ON c.id = asg.course_id
      JOIN groups g ON g.id = c.group_id
      WHERE g.faculty_id = ${facultyId}
        AND asg.status = 'PUBLISHED'
        AND asg.due_at < now()
        AND s.status IN ('SUBMITTED', 'GRADED')
      GROUP BY s.student_id`
    return rows.map((r) => ({ studentId: r.studentId, done: Number(r.done) }))
  }

  /**
   * Сумма долей «балл / максимум» и число оценок по студенту. Среднее считает
   * вызывающий: ему же решать, что делать со студентом без единой оценки.
   */
  private async gradeRateByStudent(
    facultyId: string,
  ): Promise<{ studentId: string; sumPct: number; n: number }[]> {
    const rows = await this.prisma.$queryRaw<
      { studentId: string; sumPct: number | null; n: bigint }[]
    >`
      SELECT g.student_id AS "studentId",
             sum(g.score::float / c.max_score) AS "sumPct",
             count(*) AS n
      FROM grades g
      JOIN grade_columns c ON c.id = g.column_id
      JOIN courses co ON co.id = c.course_id
      JOIN groups gr ON gr.id = co.group_id
      WHERE gr.faculty_id = ${facultyId}
        AND c.published = true
        AND g.score IS NOT NULL
        AND c.max_score IS NOT NULL
        AND c.max_score > 0
      GROUP BY g.student_id`
    return rows.map((r) => ({ studentId: r.studentId, sumPct: r.sumPct ?? 0, n: Number(r.n) }))
  }

  /** Обзор факультета: показатели + посещаемость по группам + «требует внимания». */
  async facultyOverview(viewer: JwtPayload, requestedFacultyId?: string) {
    // Область проверяется до кэша: из кэша отдаётся только то, к чему смотрящий допущен.
    const facultyId = await this.resolveFaculty(viewer, requestedFacultyId)
    return this.cached(facultyOverviewKey(facultyId), () => this.computeFacultyOverview(facultyId))
  }

  private async computeFacultyOverview(facultyId: string) {
    const now = new Date()

    const [groups, students, attendance, submissionsPending, examsUpcoming] = await Promise.all([
      this.prisma.group.findMany({
        where: { facultyId },
        select: { id: true, name: true },
        take: FACULTY_GROUPS_LIMIT,
      }),
      this.prisma.user.findMany({
        where: {
          facultyId,
          role: { in: ['STUDENT', 'STAROSTA'] },
          deletedAt: null,
          isBlocked: false,
        },
        select: { groupId: true },
        take: 20000,
      }),
      this.attendanceByGroup(facultyId),
      this.prisma.submission.count({
        where: { status: 'SUBMITTED', assignment: { course: { group: { facultyId } } } },
      }),
      this.prisma.exam.count({ where: { group: { facultyId }, date: { gte: now } } }),
    ])

    // Студенты по группам.
    const studentByGroup = new Map<string, number>()
    for (const s of students) {
      if (!s.groupId) continue
      studentByGroup.set(s.groupId, (studentByGroup.get(s.groupId) ?? 0) + 1)
    }

    // Посещаемость по группам + факультету: строки уже свёрнуты базой (attendanceByGroup),
    // здесь остаётся сложить группы в факультет.
    const attByGroup = new Map(attendance.map((row) => [row.groupId, row]))
    const facultyAtt = { total: 0, absent: 0 }
    for (const row of attendance) {
      facultyAtt.total += row.total
      facultyAtt.absent += row.absent
    }

    const groupStats = groups
      .map((g) => {
        const att = attByGroup.get(g.id) ?? { total: 0, absent: 0 }
        return {
          groupId: g.id,
          name: g.name,
          students: studentByGroup.get(g.id) ?? 0,
          attendanceRate: rateOf(att),
          attendanceTracked: att.total,
        }
      })
      .sort((a, b) => a.attendanceRate - b.attendanceRate)

    const atRisk = groupStats.filter(
      (g) => g.attendanceTracked > 0 && g.attendanceRate < AT_RISK_THRESHOLD,
    )

    return {
      facultyId,
      totals: {
        groups: groups.length,
        students: students.length,
        attendanceRate: rateOf(facultyAtt),
        submissionsPending,
        examsUpcoming,
      },
      groups: groupStats,
      atRisk: atRisk.map((g) => ({
        groupId: g.groupId,
        name: g.name,
        attendanceRate: g.attendanceRate,
      })),
    }
  }

  /**
   * Drill-down: посещаемость по студентам группы.
   *
   * Сворачивает база (attendanceByStudentInGroup). Раньше сюда приезжали сырые отметки
   * с потолком в 20 000 строк без порядка: к середине второго курса у группы их больше,
   * и Postgres отдавал произвольное подмножество — проценты считались по случайной
   * выборке без признака обрезки. Период тот же, что у обзора факультета (вся история),
   * иначе процент группы в обзоре и в drill-down расходился бы.
   */
  async groupAttendance(viewer: JwtPayload, groupId: string) {
    await this.assertGroupScope(viewer, groupId)
    return this.cached(groupAttendanceKey(groupId), () => this.computeGroupAttendance(groupId))
  }

  private async computeGroupAttendance(groupId: string) {
    const [students, attendance] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          groupId,
          role: { in: ['STUDENT', 'STAROSTA'] },
          deletedAt: null,
          isBlocked: false,
        },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        take: GROUP_STUDENTS_LIMIT,
      }),
      this.attendanceByStudentInGroup(groupId),
    ])
    const byStudent = new Map(attendance.map((row) => [row.studentId, row]))
    return {
      groupId,
      students: students.map((s) => {
        const att = byStudent.get(s.id) ?? { total: 0, absent: 0 }
        return {
          studentId: s.id,
          firstName: s.firstName,
          lastName: s.lastName,
          attendanceRate: rateOf(att),
          tracked: att.total,
        }
      }),
    }
  }

  /**
   * Early Warning: студенты факультета «требует внимания» с ЯВНЫМИ причинами
   * (docs/UNIFIED_UX.md PR-7). Три объективных признака, каждый с числовым значением:
   * низкая посещаемость (<60%), просроченные задания (штук), низкий средний балл (<50%).
   * Никаких скрытых скорингов — severity = число сработавших причин.
   */
  async atRiskStudents(viewer: JwtPayload, requestedFacultyId?: string) {
    const facultyId = await this.resolveFaculty(viewer, requestedFacultyId)
    const now = new Date()

    const [students, groups, attendance, dueAssignments, doneAssignments, gradeRates] =
      await Promise.all([
        this.prisma.user.findMany({
          where: {
            facultyId,
            role: { in: ['STUDENT', 'STAROSTA'] },
            deletedAt: null,
            isBlocked: false,
          },
          select: { id: true, firstName: true, lastName: true, groupId: true },
          take: 20000,
        }),
        this.prisma.group.findMany({
          where: { facultyId },
          select: { id: true, name: true },
          take: FACULTY_GROUPS_LIMIT,
        }),
        this.attendanceByStudent(facultyId),
        // Опубликованные задания с истёкшим сроком в группах факультета.
        this.prisma.assignment.findMany({
          where: { status: 'PUBLISHED', dueAt: { lt: now }, course: { group: { facultyId } } },
          select: { id: true, course: { select: { groupId: true } } },
          take: 20000,
        }),
        this.doneAssignmentsByStudent(facultyId),
        this.gradeRateByStudent(facultyId),
      ])

    const groupName = new Map(groups.map((g) => [g.id, g.name]))

    // Посещаемость и сдачи приходят уже свёрнутыми базой — остаётся разложить по ключу.
    const att = new Map(attendance.map((row) => [row.studentId, row]))
    const doneByStudent = new Map(doneAssignments.map((row) => [row.studentId, row.done]))
    const dueByGroup = new Map<string, string[]>()
    for (const a of dueAssignments) {
      const gid = a.course.groupId
      const arr = dueByGroup.get(gid) ?? []
      arr.push(a.id)
      dueByGroup.set(gid, arr)
    }

    // Средний процент по опубликованным колонкам — тоже агрегат базы (gradeRateByStudent).
    const gradeAgg = new Map(gradeRates.map((row) => [row.studentId, row]))

    const atRisk = []
    for (const s of students) {
      const reasons: RiskReason[] = []

      const a = att.get(s.id)
      if (a && a.total > 0) {
        const rate = rateOf(a)
        if (rate < AT_RISK_THRESHOLD) reasons.push({ kind: 'LOW_ATTENDANCE', value: rate })
      }

      if (s.groupId) {
        // Просрочено = сколько заданий группы с истёкшим сроком студент не сдал. Считается
        // вычитанием, а не разностью множеств: база возвращает ЧИСЛО сдач студента по тем
        // же заданиям, и тянуть сто тысяч идентификаторов ради той же цифры незачем.
        const dueCount = dueByGroup.get(s.groupId)?.length ?? 0
        const overdue = Math.max(0, dueCount - (doneByStudent.get(s.id) ?? 0))
        if (overdue > 0) reasons.push({ kind: 'OVERDUE_ASSIGNMENTS', value: overdue })
      }

      const ga = gradeAgg.get(s.id)
      if (ga && ga.n > 0) {
        const avg = Math.round((ga.sumPct / ga.n) * 100)
        if (avg < GRADE_RISK_THRESHOLD) reasons.push({ kind: 'LOW_GRADES', value: avg })
      }

      if (reasons.length > 0) {
        atRisk.push({
          studentId: s.id,
          firstName: s.firstName,
          lastName: s.lastName,
          groupId: s.groupId,
          groupName: s.groupId ? (groupName.get(s.groupId) ?? null) : null,
          reasons,
          severity: reasons.length,
        })
      }
    }
    // Больше причин — выше в списке; при равенстве — по фамилии.
    atRisk.sort((x, y) => y.severity - x.severity || x.lastName.localeCompare(y.lastName))

    return {
      facultyId,
      thresholds: { attendance: AT_RISK_THRESHOLD, gradeAvg: GRADE_RISK_THRESHOLD },
      students: atRisk,
    }
  }

  // Обзоры преподавателя и старосты (`GET /analytics/teacher`, `GET /analytics/my-group`)
  // убраны (B-F24): ни веб, ни мини-апп, ни мобильные клиенты их не вызывали, а это ~280
  // строк без тестов со своими выборками на десятки тысяч строк. Дашборд преподавателя в
  // вебе собран из его рабочих разделов, у старосты — экран своей группы.

  // ── scope ─────────────────────────────────────────────────────────────────

  private async resolveFaculty(viewer: JwtPayload, requested?: string): Promise<string> {
    if (viewer.role === Role.DEAN) {
      if (!viewer.facultyId) throw new AppException('NOT_FOUND', 'Факультет не назначен')
      return viewer.facultyId
    }
    if (!requested) throw new AppException('BAD_REQUEST', 'Не указан факультет')
    if (isPlatform(viewer.role)) return requested
    if (viewer.role === Role.UNIVERSITY_ADMIN) {
      const faculty = await this.prisma.faculty.findUnique({
        where: { id: requested },
        select: { universityId: true },
      })
      if (!faculty) throw new AppException('NOT_FOUND', 'Факультет не найден')
      if (faculty.universityId !== viewer.universityId) {
        throw new AppException('WRONG_SCOPE', 'Другой университет')
      }
      return requested
    }
    throw new AppException('FORBIDDEN', 'Недостаточно прав')
  }

  private async assertGroupScope(viewer: JwtPayload, groupId: string): Promise<void> {
    if (isPlatform(viewer.role)) return
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { facultyId: true, faculty: { select: { universityId: true } } },
    })
    if (!group) throw new AppException('NOT_FOUND', 'Группа не найдена')
    if (viewer.role === Role.DEAN) {
      if (viewer.facultyId === group.facultyId) return
      throw new AppException('WRONG_SCOPE', 'Другой факультет')
    }
    if (viewer.role === Role.UNIVERSITY_ADMIN) {
      if (viewer.universityId === group.faculty.universityId) return
      throw new AppException('WRONG_SCOPE', 'Другой университет')
    }
    throw new AppException('FORBIDDEN', 'Недостаточно прав')
  }
}
