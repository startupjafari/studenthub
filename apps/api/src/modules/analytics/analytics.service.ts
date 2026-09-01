import { Injectable } from '@nestjs/common'
import { Role } from '@studenthub/shared-types'
import { PrismaService } from '../../common/prisma/prisma.service'
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

const AT_RISK_THRESHOLD = 60
const GRADE_RISK_THRESHOLD = 50

// Потолки выборок ролевых дашбордов (§5.3). Объёмы здесь на порядок меньше факультетских:
// у преподавателя это только его курсы и пары, у старосты — одна группа.
const TEACHER_SCOPE_LIMIT = 300
const TEACHER_ATTENDANCE_LIMIT = 50_000
// Сколько строк показывают панели-списки. Число общее для обеих панелей преподавателя:
// они стоят рядом в сетке, и разная длина списков читается как перекос.
const TEACHER_LIST_ROWS = 6
const GROUP_STUDENTS_LIMIT = 500
const GROUP_ATTENDANCE_LIMIT = 20_000
const GROUP_LIST_ROWS = 6
// Дисциплин у группы в семестре единицы; 12 полос — предел читаемой высоты графика.
const GROUP_SUBJECT_ROWS = 12

// Причина попадания студента в зону риска — всегда объективна и с числовым значением
// (никаких непрозрачных авто-решений). value интерпретируется по kind (проценты/штуки).
interface RiskReason {
  kind: 'LOW_ATTENDANCE' | 'OVERDUE_ASSIGNMENTS' | 'LOW_GRADES'
  value: number
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Обзор факультета: показатели + посещаемость по группам + «требует внимания». */
  async facultyOverview(viewer: JwtPayload, requestedFacultyId?: string) {
    const facultyId = await this.resolveFaculty(viewer, requestedFacultyId)
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
      this.prisma.attendance.findMany({
        where: { pair: { group: { facultyId } } },
        select: { status: true, pair: { select: { groupId: true } } },
        take: 50000,
      }),
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

    // Посещаемость по группам + факультету.
    const attByGroup = new Map<string, { total: number; absent: number }>()
    const facultyAtt = { total: 0, absent: 0 }
    for (const a of attendance) {
      const gid = a.pair.groupId
      const cur = attByGroup.get(gid) ?? { total: 0, absent: 0 }
      cur.total += 1
      facultyAtt.total += 1
      if (a.status === 'ABSENT') {
        cur.absent += 1
        facultyAtt.absent += 1
      }
      attByGroup.set(gid, cur)
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

  /** Drill-down: посещаемость по студентам группы. */
  async groupAttendance(viewer: JwtPayload, groupId: string) {
    await this.assertGroupScope(viewer, groupId)
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
        take: 500,
      }),
      this.prisma.attendance.findMany({
        where: { pair: { groupId } },
        select: { studentId: true, status: true },
        take: 20000,
      }),
    ])
    const byStudent = new Map<string, { total: number; absent: number }>()
    for (const a of attendance) {
      const cur = byStudent.get(a.studentId) ?? { total: 0, absent: 0 }
      cur.total += 1
      if (a.status === 'ABSENT') cur.absent += 1
      byStudent.set(a.studentId, cur)
    }
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

    const [students, groups, attendance, dueAssignments, submissions, columns, grades] =
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
        this.prisma.attendance.findMany({
          where: { pair: { group: { facultyId } } },
          select: { studentId: true, status: true },
          take: 100000,
        }),
        // Опубликованные задания с истёкшим сроком в группах факультета.
        this.prisma.assignment.findMany({
          where: { status: 'PUBLISHED', dueAt: { lt: now }, course: { group: { facultyId } } },
          select: { id: true, course: { select: { groupId: true } } },
          take: 20000,
        }),
        this.prisma.submission.findMany({
          where: {
            assignment: {
              status: 'PUBLISHED',
              dueAt: { lt: now },
              course: { group: { facultyId } },
            },
          },
          select: { assignmentId: true, studentId: true, status: true },
          take: 100000,
        }),
        this.prisma.gradeColumn.findMany({
          where: { published: true, course: { group: { facultyId } } },
          select: { id: true, maxScore: true },
          take: 20000,
        }),
        this.prisma.grade.findMany({
          where: {
            column: { published: true, course: { group: { facultyId } } },
            score: { not: null },
          },
          select: { columnId: true, studentId: true, score: true },
          take: 200000,
        }),
      ])

    const groupName = new Map(groups.map((g) => [g.id, g.name]))

    // Посещаемость по студенту.
    const att = new Map<string, { total: number; absent: number }>()
    for (const a of attendance) {
      const cur = att.get(a.studentId) ?? { total: 0, absent: 0 }
      cur.total += 1
      if (a.status === 'ABSENT') cur.absent += 1
      att.set(a.studentId, cur)
    }

    // Сдал = есть submission со статусом SUBMITTED или GRADED.
    const doneByStudent = new Map<string, Set<string>>()
    for (const s of submissions) {
      if (s.status === 'SUBMITTED' || s.status === 'GRADED') {
        const set = doneByStudent.get(s.studentId) ?? new Set<string>()
        set.add(s.assignmentId)
        doneByStudent.set(s.studentId, set)
      }
    }
    const dueByGroup = new Map<string, string[]>()
    for (const a of dueAssignments) {
      const gid = a.course.groupId
      const arr = dueByGroup.get(gid) ?? []
      arr.push(a.id)
      dueByGroup.set(gid, arr)
    }

    // Средний процент по опубликованным колонкам оценок.
    const maxByColumn = new Map(columns.map((c) => [c.id, c.maxScore]))
    const gradeAgg = new Map<string, { sumPct: number; n: number }>()
    for (const g of grades) {
      const max = maxByColumn.get(g.columnId)
      if (!max || g.score == null) continue
      const cur = gradeAgg.get(g.studentId) ?? { sumPct: 0, n: 0 }
      cur.sumPct += g.score / max
      cur.n += 1
      gradeAgg.set(g.studentId, cur)
    }

    const atRisk = []
    for (const s of students) {
      const reasons: RiskReason[] = []

      const a = att.get(s.id)
      if (a && a.total > 0) {
        const rate = rateOf(a)
        if (rate < AT_RISK_THRESHOLD) reasons.push({ kind: 'LOW_ATTENDANCE', value: rate })
      }

      if (s.groupId) {
        const dueIds = dueByGroup.get(s.groupId) ?? []
        const done = doneByStudent.get(s.id) ?? new Set<string>()
        const overdue = dueIds.filter((id) => !done.has(id)).length
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

  /**
   * Дашборд преподавателя: его собственная нагрузка и то, что ждёт действия.
   *
   * Scope целиком из токена (`viewer.sub`) — идентификатора преподавателя в запросе нет
   * вовсе, подменить его нечем. Считается по двум опорам, и это разные вещи:
   * `Course.teacherId` — что я веду (задания, оценки, экзамены), `Pair.teacherId` — что я
   * провожу (посещаемость). Занятие может стоять на замене, а курс при этом остаётся за
   * другим преподавателем, поэтому объединять их в одну выборку нельзя.
   */
  async teacherOverview(viewer: JwtPayload) {
    const teacherId = viewer.sub
    const now = new Date()

    const [courses, pairGroups] = await Promise.all([
      this.prisma.course.findMany({
        where: { teacherId },
        select: { id: true, groupId: true },
        take: TEACHER_SCOPE_LIMIT,
      }),
      this.prisma.pair.findMany({
        where: { teacherId },
        select: { groupId: true },
        distinct: ['groupId'],
        take: TEACHER_SCOPE_LIMIT,
      }),
    ])

    const groupIds = [
      ...new Set([...courses.map((c) => c.groupId), ...pairGroups.map((p) => p.groupId)]),
    ]

    const [groups, students, attendance, submissionsPending, examsUpcoming, queue, consultations] =
      await Promise.all([
        this.prisma.group.findMany({
          where: { id: { in: groupIds } },
          select: { id: true, name: true },
          take: groupIds.length || 1,
        }),
        this.prisma.user.groupBy({
          by: ['groupId'],
          where: {
            groupId: { in: groupIds },
            role: { in: ['STUDENT', 'STAROSTA'] },
            deletedAt: null,
            isBlocked: false,
          },
          _count: { _all: true },
        }),
        // Посещаемость — по парам, которые вёл именно этот преподаватель.
        this.prisma.attendance.findMany({
          where: { pair: { teacherId } },
          select: { status: true, pair: { select: { groupId: true } } },
          take: TEACHER_ATTENDANCE_LIMIT,
        }),
        this.prisma.submission.count({
          where: { status: 'SUBMITTED', assignment: { course: { teacherId } } },
        }),
        // Экзамен может вести не тот, кто читал курс (внешний экзаменатор и наоборот).
        this.prisma.exam.count({
          where: { date: { gte: now }, OR: [{ examinerId: teacherId }, { course: { teacherId } }] },
        }),
        // Очередь проверки — по заданиям, где сдач больше всего: с них и начинают.
        this.prisma.submission.groupBy({
          by: ['assignmentId'],
          where: { status: 'SUBMITTED', assignment: { course: { teacherId } } },
          _count: { _all: true },
          orderBy: { _count: { assignmentId: 'desc' } },
          take: TEACHER_LIST_ROWS,
        }),
        // Записанного студента преподаватель и так видит в своём разделе консультаций
        // (ConsultationsService отдаёт имя), поэтому здесь оно не новое раскрытие.
        this.prisma.consultationSlot.findMany({
          where: { teacherId, startsAt: { gte: now }, status: { in: ['OPEN', 'BOOKED'] } },
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            status: true,
            isOnline: true,
            location: true,
            topic: true,
            student: { select: { firstName: true, lastName: true } },
          },
          orderBy: { startsAt: 'asc' },
          take: TEACHER_LIST_ROWS,
        }),
      ])

    const queueIds = queue.map((q) => q.assignmentId)
    const queueAssignments = queueIds.length
      ? await this.prisma.assignment.findMany({
          where: { id: { in: queueIds } },
          select: {
            id: true,
            title: true,
            dueAt: true,
            course: {
              select: { subject: { select: { name: true } }, group: { select: { name: true } } },
            },
          },
          take: queueIds.length,
        })
      : []

    const studentsByGroup = new Map(students.map((s) => [s.groupId, s._count._all]))
    const attByGroup = new Map<string, { total: number; absent: number }>()
    const teacherAtt = { total: 0, absent: 0 }
    for (const a of attendance) {
      const gid = a.pair.groupId
      const cur = attByGroup.get(gid) ?? { total: 0, absent: 0 }
      cur.total += 1
      teacherAtt.total += 1
      if (a.status === 'ABSENT') {
        cur.absent += 1
        teacherAtt.absent += 1
      }
      attByGroup.set(gid, cur)
    }

    // Худшие группы сверху: график для того и нужен, чтобы увидеть проседание.
    const groupStats = groups
      .map((g) => {
        const att = attByGroup.get(g.id) ?? { total: 0, absent: 0 }
        return {
          groupId: g.id,
          name: g.name,
          students: studentsByGroup.get(g.id) ?? 0,
          attendanceRate: rateOf(att),
          attendanceTracked: att.total,
        }
      })
      .sort((a, b) => a.attendanceRate - b.attendanceRate)

    const assignmentById = new Map(queueAssignments.map((a) => [a.id, a]))

    return {
      thresholds: { attendance: AT_RISK_THRESHOLD },
      totals: {
        courses: courses.length,
        groups: groupStats.length,
        students: [...studentsByGroup.values()].reduce((a, b) => a + b, 0),
        attendanceRate: rateOf(teacherAtt),
        attendanceTracked: teacherAtt.total,
        submissionsPending,
        examsUpcoming,
      },
      groups: groupStats,
      // Порядок сохраняется от groupBy (по числу сдач), поэтому идём по нему, а не по
      // выборке заданий: она вернулась в произвольном порядке.
      queue: queue.flatMap((q) => {
        const a = assignmentById.get(q.assignmentId)
        if (!a) return []
        return [
          {
            assignmentId: a.id,
            title: a.title,
            subject: a.course.subject.name,
            groupName: a.course.group.name,
            dueAt: a.dueAt,
            pending: q._count._all,
          },
        ]
      }),
      consultations: consultations.map((c) => ({
        id: c.id,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        status: c.status,
        isOnline: c.isOnline,
        location: c.location,
        topic: c.topic,
        studentName: c.student ? `${c.student.firstName} ${c.student.lastName}` : null,
      })),
    }
  }

  /**
   * Дашборд старосты: состояние ЕГО группы. Группа берётся из токена (`viewer.groupId`) —
   * параметра в запросе нет, поэтому чужую группу не запросить в принципе.
   *
   * Персональных срезов здесь нет намеренно: староста — такой же студент, и посещаемость
   * однокурсников по именам ему не показывается. Наружу уходят только агрегаты по группе
   * и число студентов ниже порога — без имён и без идентификаторов.
   */
  async myGroupOverview(viewer: JwtPayload) {
    const groupId = viewer.groupId
    if (!groupId) {
      throw new AppException('NOT_FOUND', 'Группа не назначена')
    }
    const now = new Date()

    const [group, students, attendance, assignmentsOpen, examsUpcoming, exams] = await Promise.all([
      this.prisma.group.findUnique({ where: { id: groupId }, select: { name: true } }),
      this.prisma.user.findMany({
        where: {
          groupId,
          role: { in: ['STUDENT', 'STAROSTA'] },
          deletedAt: null,
          isBlocked: false,
        },
        select: { id: true },
        take: GROUP_STUDENTS_LIMIT,
      }),
      this.prisma.attendance.findMany({
        where: { pair: { groupId } },
        select: { studentId: true, status: true, pair: { select: { subject: true } } },
        take: GROUP_ATTENDANCE_LIMIT,
      }),
      // Активные задания: срок ещё не вышел либо не задан вовсе.
      this.prisma.assignment.count({
        where: {
          status: 'PUBLISHED',
          course: { groupId },
          OR: [{ dueAt: null }, { dueAt: { gte: now } }],
        },
      }),
      this.prisma.exam.count({ where: { groupId, date: { gte: now } } }),
      this.prisma.exam.findMany({
        where: { groupId, date: { gte: now } },
        select: {
          id: true,
          date: true,
          format: true,
          course: { select: { subject: { select: { name: true } } } },
          room: { select: { name: true } },
        },
        orderBy: { date: 'asc' },
        take: GROUP_LIST_ROWS,
      }),
    ])
    if (!group) {
      throw new AppException('NOT_FOUND', 'Группа не найдена')
    }

    const byStudent = new Map<string, { total: number; absent: number }>()
    const bySubject = new Map<string, { total: number; absent: number }>()
    const groupAtt = { total: 0, absent: 0 }
    for (const a of attendance) {
      const st = byStudent.get(a.studentId) ?? { total: 0, absent: 0 }
      const sub = bySubject.get(a.pair.subject) ?? { total: 0, absent: 0 }
      st.total += 1
      sub.total += 1
      groupAtt.total += 1
      if (a.status === 'ABSENT') {
        st.absent += 1
        sub.absent += 1
        groupAtt.absent += 1
      }
      byStudent.set(a.studentId, st)
      bySubject.set(a.pair.subject, sub)
    }

    // Сколько человек ниже порога — числом, без имён (см. комментарий к методу).
    // Студенты без отметок вовсе не считаются: там нечего мерить, а не «ноль процентов».
    const lowAttendance = students.filter((s) => {
      const att = byStudent.get(s.id)
      return att && att.total > 0 && rateOf(att) < AT_RISK_THRESHOLD
    }).length

    const subjects = [...bySubject.entries()]
      .map(([subject, att]) => ({
        subject,
        attendanceRate: rateOf(att),
        attendanceTracked: att.total,
      }))
      .sort((a, b) => a.attendanceRate - b.attendanceRate)
      .slice(0, GROUP_SUBJECT_ROWS)

    return {
      groupId,
      name: group.name,
      thresholds: { attendance: AT_RISK_THRESHOLD },
      totals: {
        students: students.length,
        attendanceRate: rateOf(groupAtt),
        attendanceTracked: groupAtt.total,
        lowAttendance,
        assignmentsOpen,
        examsUpcoming,
      },
      subjects,
      exams: exams.map((e) => ({
        id: e.id,
        date: e.date,
        format: e.format,
        subject: e.course.subject.name,
        roomName: e.room?.name ?? null,
      })),
    }
  }

  // ── scope ─────────────────────────────────────────────────────────────────

  private async resolveFaculty(viewer: JwtPayload, requested?: string): Promise<string> {
    if (viewer.role === Role.DEAN) {
      if (!viewer.facultyId) throw new AppException('NOT_FOUND', 'Факультет не назначен')
      return viewer.facultyId
    }
    if (!requested) throw new AppException('BAD_REQUEST', 'Не указан факультет')
    if (isPlatform(viewer.role)) return requested
    if (viewer.role === Role.UNIVERSITY_ADMIN || viewer.role === Role.UNIVERSITY_MODERATOR) {
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
    if (viewer.role === Role.UNIVERSITY_ADMIN || viewer.role === Role.UNIVERSITY_MODERATOR) {
      if (viewer.universityId === group.faculty.universityId) return
      throw new AppException('WRONG_SCOPE', 'Другой университет')
    }
    throw new AppException('FORBIDDEN', 'Недостаточно прав')
  }
}
