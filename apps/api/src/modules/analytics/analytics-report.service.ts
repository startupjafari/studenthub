import { Inject, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type Redis from 'ioredis'
import { Role } from '@studenthub/shared-types'
import type { AnalyticsReportFormat, AnalyticsReportPeriod } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { REDIS_CLIENT } from '../../common/redis/redis.module'
import { AppException } from '../../common/exceptions/app.exception'
import { AuditService } from '../../common/audit/audit.service'
import { ExportBrandingService } from '../../common/export/export-branding.service'
import { ExportRegistryService } from '../../common/export/export-registry.service'
import type { ExportContext, ExportLocale } from '../../common/export/export-branding.types'
import { buildCsv, buildWorkbook } from '../../common/export/spreadsheet.builder'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { reportColumns, reportRows } from './analytics-report.export'

/**
 * Отчёт по сводке файлом (Ф14.2, решение владельца: «выгрузка сводок в XLSX/CSV»).
 *
 * Одна выгрузка на все сводки модуля: что в неё попадёт, решает роль из токена.
 *
 * | Роль | Область | Строка файла |
 * |---|---|---|
 * | Админ и модератор платформы | вся платформа | вуз |
 * | Админ и модератор вуза | свой вуз | факультет |
 * | Декан (или админ вуза с `facultyId`) | факультет | группа |
 * | Преподаватель | свои пары и курсы | группа |
 *
 * Показатели — те, что уже считают сводки, только в границах периода: посещаемость (как в
 * обзоре факультета и структуре посещаемости вуза), успеваемость (средний процент по
 * опубликованным колонкам — как в Early Warning, и исходы экзаменов — как в сводке вуза),
 * заявки (поступило / закрыто / с просрочкой — как в потоке заявок вуза), активность
 * (сданные работы и активные по журналу действий — как DAU платформы). Новых метрик нет.
 *
 * Подразделение привязывается через группу: пары, курсы, экзамены и студенты знают свою
 * группу, а группа — факультет и вуз. Так у всех показателей одна и та же раскладка, и
 * строка «Инженерный» складывается из тех же групп во всех колонках.
 *
 * Порог малых групп — как у отчёта карьеры: подразделение, где меньше REPORT_MIN_CELL
 * студентов, остаётся в файле строкой без чисел. «В группе трое, посещаемость 33 %» —
 * это уже сведения о конкретных людях, а не агрегат.
 */

/** Ниже этого числа студентов показатели подразделения не раскрываются. */
export const REPORT_MIN_CELL = 5
/**
 * Потолок строк файла. Отчёт обрезанным не отдаётся: неполный файл, который выглядит
 * полным, опаснее отказа — по нему принимают решения (так же у выгрузки пользователей).
 */
export const REPORT_MAX_UNITS = 1000
/** Кэш расчёта: числа за период меняются медленно, а книга собирается по готовому. */
const CACHE_TTL_SECONDS = 300
const DAY_MS = 86_400_000

const STUDENT_ROLES = Prisma.sql`('STUDENT', 'STAROSTA')`

export type ReportLevel = 'platform' | 'university' | 'faculty' | 'teacher'

export interface ReportScope {
  level: ReportLevel
  /** Вуз, факультет или преподаватель области; у платформы — null. */
  id: string | null
  /** Вуз области — для таймзоны дат в файле. У платформы — null (UTC). */
  universityId: string | null
}

export interface ReportMetrics {
  students: number
  attendance: { marks: number; rate: number | null; absent: number; late: number; excused: number }
  grades: { count: number; avg: number | null }
  exams: { passed: number; failed: number; absent: number; retake: number }
  /** null — у уровня показателя нет: заявки преподавателю не подают. */
  applications: { submitted: number; closed: number; overdue: number } | null
  submissions: number
  /** null — у преподавателя показателя нет (см. reportColumns). */
  activeStudents: number | null
}

export interface ReportUnit {
  id: string
  name: string
  /** В подразделении меньше REPORT_MIN_CELL студентов — показатели скрыты. */
  suppressed: boolean
  metrics: ReportMetrics | null
}

export interface AnalyticsReport {
  level: ReportLevel
  scopeId: string | null
  period: AnalyticsReportPeriod
  from: string
  to: string
  minCell: number
  /** Сколько подразделений скрыто порогом. */
  suppressed: number
  units: ReportUnit[]
  /**
   * Итог области. null — во всей области меньше порога студентов. `partial` — итог
   * посчитан без скрытых подразделений: если скрыто одно, разность «итого минус видимые»
   * раскрыла бы его целиком.
   */
  total: { metrics: ReportMetrics; partial: boolean } | null
}

/** Сырые счётчики подразделения — то, что приходит из SQL. */
interface Counts {
  students: number
  marks: number
  absent: number
  late: number
  excused: number
  gradeSum: number
  gradeN: number
  passed: number
  failed: number
  examAbsent: number
  retake: number
  submitted: number
  closed: number
  overdue: number
  submissions: number
  active: number
}

const ZERO: Counts = {
  students: 0,
  marks: 0,
  absent: 0,
  late: 0,
  excused: 0,
  gradeSum: 0,
  gradeN: 0,
  passed: 0,
  failed: 0,
  examAbsent: 0,
  retake: 0,
  submitted: 0,
  closed: 0,
  overdue: 0,
  submissions: 0,
  active: 0,
}

type Bigish = bigint | number | null

@Injectable()
export class AnalyticsReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branding: ExportBrandingService,
    private readonly exports: ExportRegistryService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Область отчёта — только из токена. `facultyId` сужает её до факультета там, где роль
   * видит больше одного: админ вуза (проверяется принадлежность своему вузу) и
   * платформенные роли. Декан всегда получает свой факультет — как в обзоре факультета.
   */
  async resolveScope(viewer: JwtPayload, facultyId?: string): Promise<ReportScope> {
    const platform = viewer.role === Role.PLATFORM_ADMIN || viewer.role === Role.PLATFORM_MODERATOR
    const university =
      viewer.role === Role.UNIVERSITY_ADMIN || viewer.role === Role.UNIVERSITY_MODERATOR

    if (viewer.role === Role.DEAN) {
      if (!viewer.facultyId) throw new AppException('NOT_FOUND', 'Факультет не назначен')
      return { level: 'faculty', id: viewer.facultyId, universityId: viewer.universityId }
    }
    if (viewer.role === Role.TEACHER) {
      if (facultyId) {
        throw new AppException('FORBIDDEN', 'Преподаватель выгружает отчёт только по своим курсам')
      }
      return { level: 'teacher', id: viewer.sub, universityId: viewer.universityId }
    }
    if (!platform && !university) throw new AppException('FORBIDDEN', 'Недостаточно прав')

    if (facultyId) {
      const faculty = await this.prisma.faculty.findUnique({
        where: { id: facultyId },
        select: { universityId: true },
      })
      if (!faculty) throw new AppException('NOT_FOUND', 'Факультет не найден')
      if (university && faculty.universityId !== viewer.universityId) {
        throw new AppException('WRONG_SCOPE', 'Другой университет')
      }
      return { level: 'faculty', id: facultyId, universityId: faculty.universityId }
    }
    if (platform) return { level: 'platform', id: null, universityId: null }
    if (!viewer.universityId) {
      throw new AppException('WRONG_SCOPE', 'Пользователь не привязан к вузу')
    }
    return { level: 'university', id: viewer.universityId, universityId: viewer.universityId }
  }

  /** Отчёт области за период — с кэшем. Ключ включает уровень, область и период. */
  async build(scope: ReportScope, period: AnalyticsReportPeriod): Promise<AnalyticsReport> {
    const key = `analytics:report:${scope.level}:${scope.id ?? 'all'}:${period}`
    try {
      const hit = await this.redis.get(key)
      if (hit) return JSON.parse(hit) as AnalyticsReport
    } catch {
      // Redis недоступен — считаем напрямую: отчёт без кэша лучше, чем без отчёта.
    }
    const report = await this.compute(scope, period)
    try {
      await this.redis.set(key, JSON.stringify(report), 'EX', CACHE_TTL_SECONDS)
    } catch {
      // см. выше
    }
    return report
  }

  /**
   * Отчёт файлом. Выгрузка попадает в два журнала — общий аудит и реестр выданных файлов
   * (DocumentExport). Самих чисел ни туда, ни туда не пишем: только объём и условия.
   */
  async exportReport(
    viewer: JwtPayload,
    query: { period: AnalyticsReportPeriod; facultyId?: string; format: AnalyticsReportFormat },
    locale: ExportLocale,
    request: { ip?: string; userAgent?: string } = {},
  ): Promise<{ body: Buffer | string; filename: string }> {
    const scope = await this.resolveScope(viewer, query.facultyId)
    const report = await this.build(scope, query.period)
    const rows = reportRows(report, locale)
    const columns = reportColumns(scope.level, locale)

    const context: ExportContext = {
      kind: 'analytics-report',
      actor: { id: viewer.sub, fullName: await this.actorName(viewer.sub) },
      locale,
      timezone: await this.universityTimezone(scope.universityId),
      generatedAt: new Date(),
      params: {
        level: scope.level,
        scopeId: scope.id ?? undefined,
        period: query.period,
        from: report.from,
        to: report.to,
      },
    }
    const body =
      query.format === 'xlsx'
        ? buildWorkbook({
            columns,
            rows,
            labels: this.branding.labels(locale),
            info: this.branding.infoRows(context),
            meta: this.branding.sheetMetadata(context),
          })
        : buildCsv({ columns, rows })

    await this.audit.record({
      userId: viewer.sub,
      action: 'analytics_report_export',
      entity: ENTITY[scope.level],
      entityId: scope.id ?? undefined,
      metadata: {
        format: query.format,
        period: query.period,
        level: scope.level,
        rows: rows.length,
        suppressed: report.suppressed,
      },
      ip: request.ip,
      userAgent: request.userAgent,
    })
    await this.exports.register({ context, format: query.format, rows: rows.length, ...request })

    return { body, filename: this.branding.filename(context, query.format) }
  }

  // ── Расчёт ────────────────────────────────────────────────────────────────

  private async compute(
    scope: ReportScope,
    period: AnalyticsReportPeriod,
  ): Promise<AnalyticsReport> {
    const range = reportRange(period)
    const units = await this.units(scope)
    if (units.length > REPORT_MAX_UNITS) {
      throw new AppException(
        'BAD_REQUEST',
        `В отчёт попадает больше ${REPORT_MAX_UNITS} подразделений. Выберите факультет.`,
      )
    }

    const teacher = scope.level === 'teacher'
    const [students, attendance, grades, exams, submissions, applications, active] =
      await Promise.all([
        this.students(scope),
        this.attendance(scope, range),
        this.grades(scope, range),
        this.exams(scope, range),
        this.submissions(scope, range),
        teacher ? Promise.resolve([]) : this.applications(scope, range),
        teacher ? Promise.resolve([]) : this.activeStudents(scope, range),
      ])

    const counts = new Map<string, Counts>(units.map((u) => [u.id, { ...ZERO }]))
    const add = (rows: Array<{ unitId: string } & Record<string, Bigish | string>>) => {
      for (const row of rows) {
        const target = counts.get(row.unitId)
        if (!target) continue
        for (const [field, value] of Object.entries(row)) {
          if (field === 'unitId' || !(field in target)) continue
          target[field as keyof Counts] += Number(value ?? 0)
        }
      }
    }
    add(students)
    add(attendance)
    add(grades)
    add(exams)
    add(submissions)
    add(applications)
    add(active)

    const all = units.map((u) => ({ ...u, counts: counts.get(u.id) ?? { ...ZERO } }))
    const hidden = all.filter((u) => u.counts.students < REPORT_MIN_CELL)
    const shown = all.filter((u) => u.counts.students >= REPORT_MIN_CELL)

    // Итог по всей области — если скрытых нет или они вместе не меньше порога: тогда
    // «итого минус видимые» раскрывает агрегат не меньше чем по пяти людям. Иначе итог
    // считается по видимым, и это помечается.
    const hiddenStudents = sumCounts(hidden.map((u) => u.counts)).students
    const partial = hidden.length > 0 && hiddenStudents < REPORT_MIN_CELL
    const totalCounts = sumCounts((partial ? shown : all).map((u) => u.counts))

    return {
      level: scope.level,
      scopeId: scope.id,
      period,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      minCell: REPORT_MIN_CELL,
      suppressed: hidden.length,
      units: all.map((u) => {
        const suppressed = u.counts.students < REPORT_MIN_CELL
        return {
          id: u.id,
          name: u.name,
          suppressed,
          metrics: suppressed ? null : toMetrics(u.counts, scope.level),
        }
      }),
      total:
        totalCounts.students < REPORT_MIN_CELL
          ? null
          : { metrics: toMetrics(totalCounts, scope.level), partial },
    }
  }

  /** Подразделения области — строки файла. На один больше потолка: так виден перебор. */
  private async units(scope: ReportScope): Promise<Array<{ id: string; name: string }>> {
    const take = REPORT_MAX_UNITS + 1
    const select = { id: true, name: true } as const
    const orderBy = { name: 'asc' } as const
    switch (scope.level) {
      case 'platform':
        return this.prisma.university.findMany({ select, orderBy, take })
      case 'university':
        return this.prisma.faculty.findMany({
          where: { universityId: scope.id as string },
          select,
          orderBy,
          take,
        })
      case 'faculty':
        return this.prisma.group.findMany({
          where: { facultyId: scope.id as string },
          select,
          orderBy,
          take,
        })
      case 'teacher':
        return this.prisma.group.findMany({
          where: {
            OR: [
              { courses: { some: { teacherId: scope.id as string } } },
              { pairs: { some: { teacherId: scope.id as string } } },
            ],
          },
          select,
          orderBy,
          take,
        })
    }
  }

  /**
   * Группы области и подразделение каждой — общая раскладка для всех показателей.
   * Фрагменты статические, значения — плейсхолдерами (§14.4).
   */
  private unitGroups(scope: ReportScope): Prisma.Sql {
    switch (scope.level) {
      case 'platform':
        return Prisma.sql`SELECT g.id AS group_id, f.university_id AS unit_id
          FROM groups g JOIN faculties f ON f.id = g.faculty_id`
      case 'university':
        return Prisma.sql`SELECT g.id AS group_id, g.faculty_id AS unit_id
          FROM groups g JOIN faculties f ON f.id = g.faculty_id
         WHERE f.university_id = ${scope.id}`
      case 'faculty':
        return Prisma.sql`SELECT g.id AS group_id, g.id AS unit_id
          FROM groups g WHERE g.faculty_id = ${scope.id}`
      case 'teacher':
        return Prisma.sql`SELECT g.id AS group_id, g.id AS unit_id
          FROM groups g
         WHERE g.id IN (SELECT c.group_id FROM courses c WHERE c.teacher_id = ${scope.id}
                        UNION
                        SELECT p.group_id FROM pairs p WHERE p.teacher_id = ${scope.id})`
    }
  }

  /** У преподавателя — только его пары: посещаемость чужих занятий группы не его. */
  private pairFilter(scope: ReportScope): Prisma.Sql {
    return scope.level === 'teacher' ? Prisma.sql`AND p.teacher_id = ${scope.id}` : Prisma.empty
  }

  /** У преподавателя — только его курсы: оценки, экзамены и работы по ним. */
  private courseFilter(scope: ReportScope): Prisma.Sql {
    return scope.level === 'teacher' ? Prisma.sql`AND co.teacher_id = ${scope.id}` : Prisma.empty
  }

  /** Студенты подразделения сейчас — по ним считается порог малых групп. */
  private students(scope: ReportScope) {
    return this.prisma.$queryRaw<Array<{ unitId: string; students: bigint }>>`
      WITH ug AS (${this.unitGroups(scope)})
      SELECT ug.unit_id AS "unitId", COUNT(*) AS students
        FROM users u
        JOIN ug ON ug.group_id = u.group_id
       WHERE u.role::text IN ${STUDENT_ROLES}
         AND u.deleted_at IS NULL
         AND u.is_blocked = false
       GROUP BY 1`
  }

  /** Посещаемость за период: те же статусы, что в структуре посещаемости вуза. */
  private attendance(scope: ReportScope, range: ReportRange) {
    return this.prisma.$queryRaw<
      Array<{ unitId: string; marks: bigint; absent: bigint; late: bigint; excused: bigint }>
    >`
      WITH ug AS (${this.unitGroups(scope)})
      SELECT ug.unit_id AS "unitId",
             COUNT(*) AS marks,
             COUNT(*) FILTER (WHERE a.status = 'ABSENT')  AS absent,
             COUNT(*) FILTER (WHERE a.status = 'LATE')    AS late,
             COUNT(*) FILTER (WHERE a.status = 'EXCUSED') AS excused
        FROM attendance a
        JOIN pairs p ON p.id = a.pair_id
        JOIN ug ON ug.group_id = p.group_id
       WHERE a.date >= ${range.from} AND a.date < ${range.to}
         ${this.pairFilter(scope)}
       GROUP BY 1`
  }

  /**
   * Средний процент «балл / максимум» по опубликованным колонкам — формула Early Warning.
   * Период — по времени выставления (updated_at): оценку часто заводят пустой и ставят позже.
   */
  private grades(scope: ReportScope, range: ReportRange) {
    return this.prisma.$queryRaw<Array<{ unitId: string; gradeSum: number; gradeN: bigint }>>`
      WITH ug AS (${this.unitGroups(scope)})
      SELECT ug.unit_id AS "unitId",
             SUM(g.score::float / c.max_score) AS "gradeSum",
             COUNT(*) AS "gradeN"
        FROM grades g
        JOIN grade_columns c ON c.id = g.column_id
        JOIN courses co ON co.id = c.course_id
        JOIN ug ON ug.group_id = co.group_id
       WHERE c.published = true
         AND g.score IS NOT NULL
         AND c.max_score IS NOT NULL
         AND c.max_score > 0
         AND g.updated_at >= ${range.from} AND g.updated_at < ${range.to}
         ${this.courseFilter(scope)}
       GROUP BY 1`
  }

  /** Исходы экзаменов, прошедших в периоде, — те же статусы, что в сводке вуза. */
  private exams(scope: ReportScope, range: ReportRange) {
    return this.prisma.$queryRaw<
      Array<{ unitId: string; passed: bigint; failed: bigint; examAbsent: bigint; retake: bigint }>
    >`
      WITH ug AS (${this.unitGroups(scope)})
      SELECT ug.unit_id AS "unitId",
             COUNT(*) FILTER (WHERE er.status = 'PASSED') AS passed,
             COUNT(*) FILTER (WHERE er.status = 'FAILED') AS failed,
             COUNT(*) FILTER (WHERE er.status = 'ABSENT') AS "examAbsent",
             COUNT(*) FILTER (WHERE er.status = 'RETAKE') AS retake
        FROM exam_results er
        JOIN exams e ON e.id = er.exam_id
        JOIN courses co ON co.id = e.course_id
        JOIN ug ON ug.group_id = e.group_id
       WHERE e.date >= ${range.from} AND e.date < ${range.to}
         ${this.courseFilter(scope)}
       GROUP BY 1`
  }

  /** Работы, сданные в периоде. */
  private submissions(scope: ReportScope, range: ReportRange) {
    return this.prisma.$queryRaw<Array<{ unitId: string; submissions: bigint }>>`
      WITH ug AS (${this.unitGroups(scope)})
      SELECT ug.unit_id AS "unitId", COUNT(*) AS submissions
        FROM submissions s
        JOIN assignments asg ON asg.id = s.assignment_id
        JOIN courses co ON co.id = asg.course_id
        JOIN ug ON ug.group_id = co.group_id
       WHERE s.submitted_at >= ${range.from} AND s.submitted_at < ${range.to}
         ${this.courseFilter(scope)}
       GROUP BY 1`
  }

  /**
   * Заявки студентов подразделения: поступило и закрыто в периоде — те же границы, что в
   * потоке заявок вуза (закрытие — готовность `ready_at`, просрочка — `ready_at > due_at`).
   */
  private applications(scope: ReportScope, range: ReportRange) {
    return this.prisma.$queryRaw<
      Array<{ unitId: string; submitted: bigint; closed: bigint; overdue: bigint }>
    >`
      WITH ug AS (${this.unitGroups(scope)})
      SELECT ug.unit_id AS "unitId",
             COUNT(*) FILTER (WHERE ap.submitted_at >= ${range.from}
                                AND ap.submitted_at < ${range.to}) AS submitted,
             COUNT(*) FILTER (WHERE ap.ready_at >= ${range.from}
                                AND ap.ready_at < ${range.to}) AS closed,
             COUNT(*) FILTER (WHERE ap.ready_at >= ${range.from}
                                AND ap.ready_at < ${range.to}
                                AND ap.due_at IS NOT NULL
                                AND ap.ready_at > ap.due_at) AS overdue
        FROM applications ap
        JOIN users u ON u.id = ap.student_id
        JOIN ug ON ug.group_id = u.group_id
       WHERE ap.deleted_at IS NULL
         AND (ap.submitted_at >= ${range.from} OR ap.ready_at >= ${range.from})
       GROUP BY 1`
  }

  /**
   * Активные студенты — с хотя бы одним действием в журнале аудита за период. Источник
   * тот же, что у DAU/WAU платформы (last_seen_at истории не хранит).
   */
  private activeStudents(scope: ReportScope, range: ReportRange) {
    return this.prisma.$queryRaw<Array<{ unitId: string; active: bigint }>>`
      WITH ug AS (${this.unitGroups(scope)})
      SELECT ug.unit_id AS "unitId", COUNT(DISTINCT u.id) AS active
        FROM audit_logs al
        JOIN users u ON u.id = al.user_id
        JOIN ug ON ug.group_id = u.group_id
       WHERE al.created_at >= ${range.from} AND al.created_at < ${range.to}
         AND u.role::text IN ${STUDENT_ROLES}
         AND u.deleted_at IS NULL
       GROUP BY 1`
  }

  /** Таймзона вуза области: даты в файле печатаются так, как их понимает деканат. */
  private async universityTimezone(universityId: string | null): Promise<string> {
    if (!universityId) return 'UTC'
    const university = await this.prisma.university.findFirst({
      where: { id: universityId },
      select: { timezone: true },
    })
    return university?.timezone ?? 'UTC'
  }

  /** ФИО выгружающего — для видимой шапки файла. В метаданные файла оно не идёт. */
  private async actorName(userId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    })
    return [user?.lastName, user?.firstName].filter(Boolean).join(' ').trim()
  }
}

const ENTITY: Record<ReportLevel, string> = {
  platform: 'Platform',
  university: 'University',
  faculty: 'Faculty',
  teacher: 'User',
}

// ── Чистые помощники ─────────────────────────────────────────────────────────

export interface ReportRange {
  from: Date
  to: Date
}

/**
 * Границы периода — те же, что у отчёта карьеры: месяц и квартал — последние 30 и 90
 * дней, год — УЧЕБНЫЙ, с 1 сентября: отчётность вуза живёт по нему.
 */
export function reportRange(period: AnalyticsReportPeriod, now: Date = new Date()): ReportRange {
  if (period === 'year') {
    const year = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
    return { from: new Date(Date.UTC(year, 8, 1)), to: now }
  }
  const days = period === 'month' ? 30 : 90
  return { from: new Date(now.getTime() - days * DAY_MS), to: now }
}

function sumCounts(list: Counts[]): Counts {
  const out = { ...ZERO }
  for (const c of list) {
    for (const key of Object.keys(out) as Array<keyof Counts>) out[key] += c[key]
  }
  return out
}

/** Доля в процентах; ноль в знаменателе — «нечего считать», а не ноль процентов. */
function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 100)
}

export function toMetrics(c: Counts, level: ReportLevel): ReportMetrics {
  const teacher = level === 'teacher'
  return {
    students: c.students,
    attendance: {
      marks: c.marks,
      // Доля не-пропусков — та же формула, что в обзоре факультета.
      rate: percent(c.marks - c.absent, c.marks),
      absent: c.absent,
      late: c.late,
      excused: c.excused,
    },
    grades: {
      count: c.gradeN,
      avg: c.gradeN === 0 ? null : Math.round((c.gradeSum / c.gradeN) * 100),
    },
    exams: { passed: c.passed, failed: c.failed, absent: c.examAbsent, retake: c.retake },
    applications: teacher ? null : { submitted: c.submitted, closed: c.closed, overdue: c.overdue },
    submissions: c.submissions,
    activeStudents: teacher ? null : c.active,
  }
}
