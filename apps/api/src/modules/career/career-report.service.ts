import { Inject, Injectable } from '@nestjs/common'
import type Redis from 'ioredis'
import type { CareerReportPeriod } from '@studenthub/shared-schemas'
import { resolveUniversityScope } from './career-scope'
import { PrismaService } from '../../common/prisma/prisma.service'
import { REDIS_CLIENT } from '../../common/redis/redis.module'
import { AuditService } from '../../common/audit/audit.service'
import { ExportBrandingService } from '../../common/export/export-branding.service'
import { ExportRegistryService } from '../../common/export/export-registry.service'
import type { ExportContext, ExportLocale } from '../../common/export/export-branding.types'
import { buildCsv, buildWorkbook } from '../../common/export/spreadsheet.builder'
import { reportColumns, reportRows } from './career-report.export'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

/**
 * Аналитический отчёт карьерного центра вуза.
 *
 * Отдельный сервис от `CareerAnalyticsService` не по объёму, а по назначению: там —
 * операционная сводка «что происходит сейчас» для обзора, здесь — разрезы за период для
 * экрана метрик и выгрузки. У них разные периоды жизни кэша и разная цена запроса.
 *
 * Правило то же: только агрегаты. Разрез по факультету — единственное место модуля, где
 * агрегат способен превратиться в персональные данные (факультет из шести человек и
 * «трудоустроен один» — это уже про конкретного человека), поэтому маленькие группы
 * скрываются порогом, а не на усмотрение интерфейса.
 */

/** Ниже этого числа студентов разрез по факультету не показывается. */
const MIN_CELL = 5
/** Сколько строк в топах: компании, города. */
const TOP_LIMIT = 10
const CITIES_LIMIT = 8
/** Корзины готовности профиля. */
const READINESS_BUCKETS = [25, 50, 75, 100] as const
/**
 * Кэш отчёта. Пять минут: экран аналитический, числа за период меняются медленно,
 * а запросов здесь на порядок больше, чем в сводке обзора.
 */
const CACHE_TTL_SECONDS = 300

const DAY_MS = 86_400_000

export interface ReportRange {
  from: Date
  to: Date
  /** Предыдущий период той же длины — для дельт. */
  previousFrom: Date
}

@Injectable()
export class CareerReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branding: ExportBrandingService,
    private readonly exports: ExportRegistryService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async forUniversity(viewer: JwtPayload, period: CareerReportPeriod, universityIdParam?: string) {
    const universityId = resolveUniversityScope(viewer, universityIdParam)
    const key = `analytics:career:report:${universityId}:${period}`
    return this.cached(key, () => this.compute(universityId, period))
  }

  private async compute(universityId: string, period: CareerReportPeriod) {
    const range = resolveRange(period)

    const [
      totals,
      timing,
      stages,
      outcomes,
      faculties,
      graduates,
      companies,
      vacancyCuts,
      salary,
      deadVacancies,
      students,
    ] = await Promise.all([
      this.totals(universityId, range),
      this.timing(universityId, range),
      this.stages(universityId, range),
      this.outcomes(universityId, range),
      this.faculties(universityId, range),
      this.graduates(universityId),
      this.companies(universityId, range),
      this.vacancyCuts(universityId),
      this.salary(universityId),
      this.deadVacancies(universityId),
      this.students(universityId, range),
    ])

    return {
      period,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      totals,
      timing,
      // Потери по шагам: сколько откликов не перешло с шага на следующий.
      funnel: { stages, dropoff: dropoff(stages) },
      outcomes,
      faculties,
      graduates,
      companies,
      vacancyCuts,
      salary,
      deadVacancies,
      students,
    }
  }

  /** Плитки: объём за период и он же за предыдущий — дельта считается на экране. */
  private async totals(universityId: string, range: ReportRange) {
    const rows = await this.prisma.$queryRaw<Array<Record<string, bigint>>>`
      SELECT
        (SELECT COUNT(*) FROM career_applications a
          WHERE a.university_id = ${universityId}
            AND a.created_at >= ${range.from} AND a.created_at < ${range.to}) AS applications,
        (SELECT COUNT(*) FROM career_applications a
          WHERE a.university_id = ${universityId}
            AND a.created_at >= ${range.previousFrom} AND a.created_at < ${range.from}) AS applications_prev,
        (SELECT COUNT(DISTINCT e.application_id)
           FROM career_application_events e
           JOIN career_applications a ON a.id = e.application_id
          WHERE a.university_id = ${universityId} AND e.to_status = 'HIRED'
            AND e.created_at >= ${range.from} AND e.created_at < ${range.to}) AS hired,
        (SELECT COUNT(DISTINCT e.application_id)
           FROM career_application_events e
           JOIN career_applications a ON a.id = e.application_id
          WHERE a.university_id = ${universityId} AND e.to_status = 'HIRED'
            AND e.created_at >= ${range.previousFrom} AND e.created_at < ${range.from}) AS hired_prev,
        (SELECT COUNT(*) FROM vacancy_university_reviews r
           JOIN vacancies v ON v.id = r.vacancy_id
          WHERE r.university_id = ${universityId} AND r.status = 'APPROVED'
            AND v.published_at >= ${range.from} AND v.published_at < ${range.to}) AS vacancies,
        (SELECT COUNT(*) FROM vacancy_university_reviews r
           JOIN vacancies v ON v.id = r.vacancy_id
          WHERE r.university_id = ${universityId} AND r.status = 'APPROVED'
            AND v.published_at >= ${range.previousFrom} AND v.published_at < ${range.from}) AS vacancies_prev,
        (SELECT COUNT(*) FROM company_university_access c
          WHERE c.university_id = ${universityId} AND c.status = 'APPROVED'
            AND c.decided_at >= ${range.from} AND c.decided_at < ${range.to}) AS companies,
        (SELECT COUNT(*) FROM company_university_access c
          WHERE c.university_id = ${universityId} AND c.status = 'APPROVED'
            AND c.decided_at >= ${range.previousFrom} AND c.decided_at < ${range.from}) AS companies_prev
    `
    const r = rows[0]
    const pair = (key: string) => ({
      value: Number(r?.[key] ?? 0),
      previous: Number(r?.[`${key}_prev`] ?? 0),
    })
    return {
      applications: pair('applications'),
      hired: pair('hired'),
      vacancies: pair('vacancies'),
      companies: pair('companies'),
    }
  }

  /**
   * Скорость процесса со стороны студента: сколько ждать первого взгляда и найма.
   *
   * Считается по первому событию нужного типа, а не по `updatedAt` отклика: отклик
   * меняется много раз, и разница «сейчас минус создание» показала бы возраст записи,
   * а не время реакции. Отрицательные длительности отбрасываются — это испорченные
   * данные, а одна такая строка утаскивает медиану ниже нуля.
   */
  private async timing(universityId: string, range: ReportRange) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        first_response_hours: number | null
        hire_days: number | null
        silent: bigint
        total: bigint
      }>
    >`
      WITH scoped AS (
        SELECT a.id, a.created_at, a.status
          FROM career_applications a
         WHERE a.university_id = ${universityId}
           AND a.created_at >= ${range.from} AND a.created_at < ${range.to}
      ),
      first_view AS (
        SELECT s.id, s.created_at, MIN(e.created_at) AS at
          FROM scoped s
          JOIN career_application_events e ON e.application_id = s.id AND e.to_status = 'VIEWED'
         GROUP BY s.id, s.created_at
      ),
      first_hire AS (
        SELECT s.id, s.created_at, MIN(e.created_at) AS at
          FROM scoped s
          JOIN career_application_events e ON e.application_id = s.id AND e.to_status = 'HIRED'
         GROUP BY s.id, s.created_at
      )
      SELECT
        (SELECT percentile_cont(0.5) WITHIN GROUP (
                  ORDER BY EXTRACT(EPOCH FROM (at - created_at)) / 3600)
           FROM first_view WHERE at >= created_at) AS first_response_hours,
        (SELECT percentile_cont(0.5) WITHIN GROUP (
                  ORDER BY EXTRACT(EPOCH FROM (at - created_at)) / 86400)
           FROM first_hire WHERE at >= created_at) AS hire_days,
        (SELECT COUNT(*) FROM scoped s
          WHERE s.status = 'SUBMITTED'
            AND NOT EXISTS (SELECT 1 FROM career_application_events e
                             WHERE e.application_id = s.id AND e.to_status <> 'SUBMITTED')) AS silent,
        (SELECT COUNT(*) FROM scoped) AS total
    `
    const r = rows[0]
    const total = Number(r?.total ?? 0)
    return {
      firstResponseHours:
        r?.first_response_hours == null ? null : Math.round(Number(r.first_response_hours)),
      hireDays: r?.hire_days == null ? null : Math.round(Number(r.hire_days)),
      // Доля откликов, на которые компания не отреагировала вообще.
      silentShare: rate(Number(r?.silent ?? 0), total),
      silent: Number(r?.silent ?? 0),
      total,
    }
  }

  /** Достигнутые шаги за период — та же логика, что в сводке обзора, но в границах периода. */
  private async stages(universityId: string, range: ReportRange): Promise<Record<string, number>> {
    const rows = await this.prisma.$queryRaw<Array<Record<string, bigint>>>`
      WITH depth AS (
        SELECT a.id,
               GREATEST(
                 1,
                 CASE a.status
                   WHEN 'VIEWED' THEN 2 WHEN 'SHORTLISTED' THEN 3 WHEN 'INTERVIEW' THEN 4
                   WHEN 'OFFER' THEN 5 WHEN 'HIRED' THEN 6 ELSE 1
                 END,
                 COALESCE(MAX(
                   CASE e.to_status
                     WHEN 'VIEWED' THEN 2 WHEN 'SHORTLISTED' THEN 3 WHEN 'INTERVIEW' THEN 4
                     WHEN 'OFFER' THEN 5 WHEN 'HIRED' THEN 6 ELSE 1
                   END
                 ), 1)
               ) AS stage
          FROM career_applications a
          LEFT JOIN career_application_events e ON e.application_id = a.id
         WHERE a.university_id = ${universityId}
           AND a.created_at >= ${range.from} AND a.created_at < ${range.to}
         GROUP BY a.id, a.status
      )
      SELECT COUNT(*) FILTER (WHERE stage >= 1) AS submitted,
             COUNT(*) FILTER (WHERE stage >= 2) AS viewed,
             COUNT(*) FILTER (WHERE stage >= 3) AS shortlisted,
             COUNT(*) FILTER (WHERE stage >= 4) AS interview,
             COUNT(*) FILTER (WHERE stage >= 5) AS offer,
             COUNT(*) FILTER (WHERE stage >= 6) AS hired
        FROM depth
    `
    const r = rows[0]
    return {
      SUBMITTED: Number(r?.submitted ?? 0),
      VIEWED: Number(r?.viewed ?? 0),
      SHORTLISTED: Number(r?.shortlisted ?? 0),
      INTERVIEW: Number(r?.interview ?? 0),
      OFFER: Number(r?.offer ?? 0),
      HIRED: Number(r?.hired ?? 0),
    }
  }

  /** Чем закончились отклики периода: найм, отказ, отзыв студентом, ещё в работе. */
  private async outcomes(universityId: string, range: ReportRange) {
    const rows = await this.prisma.careerApplication.groupBy({
      by: ['status'],
      where: { universityId, createdAt: { gte: range.from, lt: range.to } },
      _count: { _all: true },
    })
    const map = Object.fromEntries(rows.map((row) => [row.status, row._count._all]))
    const total = Object.values(map).reduce((sum, n) => sum + n, 0)
    const hired = map.HIRED ?? 0
    const rejected = map.REJECTED ?? 0
    const withdrawn = map.WITHDRAWN ?? 0
    return {
      hired,
      rejected,
      withdrawn,
      active: total - hired - rejected - withdrawn,
      total,
      rejectedShare: rate(rejected, total),
      withdrawnShare: rate(withdrawn, total),
    }
  }

  /**
   * Трудоустройство по факультетам. Строки с горсткой студентов не показываются вовсе:
   * «на факультете 4 студента, трудоустроен 1» — это сведения о конкретном человеке,
   * а не агрегат. Сколько строк скрыто — возвращаем числом, чтобы таблица не выглядела
   * полной, когда это не так.
   */
  private async faculties(universityId: string, range: ReportRange) {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; name: string; students: bigint; applied: bigint; hired: bigint }>
    >`
      SELECT f.id, f.name,
             COUNT(DISTINCT u.id) AS students,
             COUNT(DISTINCT a.student_id) AS applied,
             COUNT(DISTINCT a.student_id) FILTER (WHERE a.status = 'HIRED') AS hired
        FROM faculties f
        LEFT JOIN users u
               ON u.faculty_id = f.id AND u.role::text = 'STUDENT' AND u.deleted_at IS NULL
        LEFT JOIN career_applications a
               ON a.student_id = u.id
              AND a.created_at >= ${range.from} AND a.created_at < ${range.to}
       WHERE f.university_id = ${universityId}
       GROUP BY f.id, f.name
       ORDER BY 5 DESC, 3 DESC
    `
    const mapped = rows.map((r) => ({
      id: r.id,
      name: r.name,
      students: Number(r.students),
      applied: Number(r.applied),
      hired: Number(r.hired),
    }))
    const visible = mapped.filter((r) => r.students >= MIN_CELL)
    return {
      items: visible.slice(0, TOP_LIMIT).map((r) => ({
        ...r,
        appliedShare: rate(r.applied, r.students),
        hiredShare: rate(r.hired, r.students),
      })),
      suppressed: mapped.length - visible.length,
      minCell: MIN_CELL,
    }
  }

  /** Выпускной курс: доля трудоустроенных среди тех, кто выпускается в этом учебном году. */
  private async graduates(universityId: string) {
    const year = graduationYear(new Date())
    const [students, hired] = await Promise.all([
      this.prisma.user.count({
        where: { universityId, role: 'STUDENT', deletedAt: null, graduationYear: year },
      }),
      this.prisma.careerApplication.findMany({
        where: { universityId, status: 'HIRED', student: { graduationYear: year } },
        select: { studentId: true },
        distinct: ['studentId'],
        take: 10_000,
      }),
    ])
    return { year, students, hired: hired.length, share: rate(hired.length, students) }
  }

  /** Кто из допущенных компаний реально берёт людей, а не просто публикует вакансии. */
  private async companies(universityId: string, range: ReportRange) {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; name: string; applications: bigint; hired: bigint }>
    >`
      SELECT c.id, c.name,
             COUNT(*) AS applications,
             COUNT(*) FILTER (WHERE a.status = 'HIRED') AS hired
        FROM career_applications a
        JOIN companies c ON c.id = a.company_id
       WHERE a.university_id = ${universityId}
         AND a.created_at >= ${range.from} AND a.created_at < ${range.to}
       GROUP BY c.id, c.name
       ORDER BY 4 DESC, 3 DESC
       LIMIT ${TOP_LIMIT}
    `
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      applications: Number(r.applications),
      hired: Number(r.hired),
    }))
  }

  /**
   * Разрезы витрины: что вообще предлагают студентам этого вуза. Снимок на сегодня,
   * а не за период: вакансия живёт дольше отклика, и «сколько удалённых вакансий
   * опубликовали в марте» отвечает не на тот вопрос, что «сколько их сейчас».
   */
  private async vacancyCuts(universityId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ dim: string; key: string; n: bigint }>>`
      WITH shown AS (
        SELECT v.*
          FROM vacancies v
          JOIN vacancy_university_reviews r
            ON r.vacancy_id = v.id AND r.university_id = ${universityId} AND r.status = 'APPROVED'
         WHERE v.deleted_at IS NULL AND v.status = 'PUBLISHED'
      )
      SELECT 'employment' AS dim, employment_type AS key, COUNT(*) AS n FROM shown GROUP BY 2
      UNION ALL
      SELECT 'format', work_format, COUNT(*) FROM shown GROUP BY 2
      UNION ALL
      SELECT 'experience', experience_level, COUNT(*) FROM shown GROUP BY 2
      UNION ALL
      SELECT 'city', COALESCE(city, ''), COUNT(*) FROM shown GROUP BY 2
    `
    const pick = (dim: string) =>
      Object.fromEntries(
        rows.filter((r) => r.dim === dim && r.key !== '').map((r) => [r.key, Number(r.n)]),
      )
    const cities = rows
      .filter((r) => r.dim === 'city' && r.key !== '')
      .map((r) => ({ city: r.key, count: Number(r.n) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, CITIES_LIMIT)
    return {
      employment: pick('employment'),
      format: pick('format'),
      experience: pick('experience'),
      cities,
    }
  }

  /** Что предлагают против того, чего ждут. Медианы, а не средние: одна вилка топ-компании сдвигает среднее. */
  private async salary(universityId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        offered_min: number | null
        offered_max: number | null
        desired_min: number | null
        desired_max: number | null
        currency: string | null
      }>
    >`
      WITH shown AS (
        SELECT v.salary_min, v.salary_max, v.salary_currency
          FROM vacancies v
          JOIN vacancy_university_reviews r
            ON r.vacancy_id = v.id AND r.university_id = ${universityId} AND r.status = 'APPROVED'
         WHERE v.deleted_at IS NULL AND v.status = 'PUBLISHED'
      ),
      wanted AS (
        SELECT p.desired_salary_min, p.desired_salary_max
          FROM career_profiles p
          JOIN users u ON u.id = p.user_id
         WHERE u.university_id = ${universityId} AND u.deleted_at IS NULL
      )
      SELECT
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY salary_min)
           FROM shown WHERE salary_min IS NOT NULL) AS offered_min,
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY salary_max)
           FROM shown WHERE salary_max IS NOT NULL) AS offered_max,
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY desired_salary_min)
           FROM wanted WHERE desired_salary_min IS NOT NULL) AS desired_min,
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY desired_salary_max)
           FROM wanted WHERE desired_salary_max IS NOT NULL) AS desired_max,
        -- Валюта самая частая, а не первая попавшаяся: числа без валюты в отчёте
        -- бессмысленны, а смешивать тенге с долларами в одной медиане нельзя.
        (SELECT mode() WITHIN GROUP (ORDER BY salary_currency)
           FROM shown WHERE salary_currency IS NOT NULL) AS currency
    `
    const r = rows[0]
    const num = (v: number | null | undefined) => (v == null ? null : Math.round(Number(v)))
    return {
      offeredMin: num(r?.offered_min),
      offeredMax: num(r?.offered_max),
      desiredMin: num(r?.desired_min),
      desiredMax: num(r?.desired_max),
      currency: r?.currency ?? null,
    }
  }

  /** Одобренные вакансии, не собравшие ни одного отклика: их либо не видно, либо они не нужны. */
  private async deadVacancies(universityId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ dead: bigint; shown: bigint }>>`
      WITH shown AS (
        SELECT v.id
          FROM vacancies v
          JOIN vacancy_university_reviews r
            ON r.vacancy_id = v.id AND r.university_id = ${universityId} AND r.status = 'APPROVED'
         WHERE v.deleted_at IS NULL AND v.status = 'PUBLISHED'
      )
      SELECT COUNT(*) FILTER (
               WHERE NOT EXISTS (
                 SELECT 1 FROM career_applications a
                  WHERE a.vacancy_id = s.id AND a.university_id = ${universityId})
             ) AS dead,
             COUNT(*) AS shown
        FROM shown s
    `
    const r = rows[0]
    return { dead: Number(r?.dead ?? 0), shown: Number(r?.shown ?? 0) }
  }

  /**
   * Студенческая сторона: готовность профилей, статус поиска, резюме и открытость.
   * «Открыл профиль» и «профиль заполнен» — разные вещи, поэтому обе величины рядом.
   */
  private async students(universityId: string, range: ReportRange) {
    const [buckets, seekers, resumes, profiles, openedInPeriod, total] = await Promise.all([
      this.prisma.$queryRaw<Array<{ bucket: number; n: bigint }>>`
        SELECT width_bucket(p.readiness_score, 0, 100, 4) AS bucket, COUNT(*) AS n
          FROM career_profiles p
          JOIN users u ON u.id = p.user_id
         WHERE u.university_id = ${universityId} AND u.deleted_at IS NULL
           AND p.readiness_score IS NOT NULL
         GROUP BY 1 ORDER BY 1
      `,
      this.prisma.careerProfile.groupBy({
        by: ['employmentStatus'],
        where: { user: { universityId, deletedAt: null } },
        _count: { _all: true },
      }),
      this.prisma.resume.count({
        where: { publishedAt: { not: null }, user: { universityId, deletedAt: null } },
      }),
      this.prisma.careerProfile.count({
        where: { visibility: 'EMPLOYERS', user: { universityId, deletedAt: null } },
      }),
      this.prisma.careerProfile.count({
        where: {
          visibility: 'EMPLOYERS',
          createdAt: { gte: range.from, lt: range.to },
          user: { universityId, deletedAt: null },
        },
      }),
      this.prisma.user.count({ where: { universityId, role: 'STUDENT', deletedAt: null } }),
    ])

    // width_bucket отдаёт 1..4 (и 5 для ровно 100) — сворачиваем хвост в последнюю корзину.
    const readiness = READINESS_BUCKETS.map(() => 0)
    for (const row of buckets) {
      const index = Math.min(READINESS_BUCKETS.length - 1, Math.max(0, Number(row.bucket) - 1))
      readiness[index] = (readiness[index] ?? 0) + Number(row.n)
    }

    return {
      readiness: { buckets: readiness, edges: [...READINESS_BUCKETS] },
      seekers: Object.fromEntries(seekers.map((s) => [s.employmentStatus, s._count._all])),
      resumesPublished: resumes,
      profiles: {
        visible: profiles,
        total,
        share: rate(profiles, total),
        openedInPeriod,
      },
    }
  }

  /**
   * Тот же отчёт файлом. Отдельного расчёта нет: выгрузка обязана показывать ровно то,
   * что человек видел на экране, иначе спор «в файле другие числа» решать нечем.
   *
   * Выгрузка попадает в два журнала — общий аудит и реестр выданных файлов. Самих данных
   * ни туда, ни туда не пишем: только объём и условия (§13).
   */
  async exportReport(
    viewer: JwtPayload,
    period: CareerReportPeriod,
    universityIdParam: string | undefined,
    locale: ExportLocale,
    format: 'xlsx' | 'csv',
    request: { ip?: string; userAgent?: string } = {},
  ): Promise<{ body: Buffer | string; filename: string }> {
    const universityId = resolveUniversityScope(viewer, universityIdParam)
    const report = await this.forUniversity(viewer, period, universityIdParam)
    const rows = reportRows(report, locale)

    const context: ExportContext = {
      kind: 'career-report',
      actor: { id: viewer.sub, fullName: await this.actorName(viewer.sub) },
      locale,
      timezone: await this.universityTimezone(universityId),
      generatedAt: new Date(),
      params: { period, universityId, from: report.from, to: report.to },
    }
    const columns = reportColumns(locale)
    const body =
      format === 'xlsx'
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
      action: 'career_report_export',
      entity: 'University',
      entityId: universityId,
      metadata: { format, period, rows: rows.length },
    })
    await this.exports.register({ context, format, rows: rows.length, ...request })

    return { body, filename: this.branding.filename(context, format) }
  }

  /** Таймзона вуза отчёта: даты в файле печатаются так, как их понимает деканат. */
  private async universityTimezone(universityId: string): Promise<string> {
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

  private async cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
    try {
      const hit = await this.redis.get(key)
      if (hit) return JSON.parse(hit) as T
    } catch {
      // Redis недоступен — считаем напрямую, как и в сводке обзора.
    }
    const value = await compute()
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS)
    } catch {
      // см. выше
    }
    return value
  }
}

// ── Чистые помощники ─────────────────────────────────────────────────────────

/** Доля в процентах. Ноль в знаменателе — «ещё нечего считать», а не ноль процентов. */
export function rate(part: number, whole: number): number | null {
  if (whole === 0) return null
  return Math.round((part / whole) * 100)
}

/**
 * Границы периода. `year` — учебный год: он начинается 1 сентября, и отчёт «за год»
 * у вуза означает именно его, а не последние 365 дней.
 */
export function resolveRange(period: CareerReportPeriod, now: Date = new Date()): ReportRange {
  if (period === 'year') {
    const from = academicYearStart(now)
    // Предыдущий учебный год — ровно на год раньше, а не «столько же дней назад».
    const previousFrom = new Date(
      Date.UTC(from.getUTCFullYear() - 1, from.getUTCMonth(), from.getUTCDate()),
    )
    return { from, to: now, previousFrom }
  }
  const days = period === 'month' ? 30 : 90
  const from = new Date(now.getTime() - days * DAY_MS)
  return { from, to: now, previousFrom: new Date(from.getTime() - days * DAY_MS) }
}

/** 1 сентября текущего учебного года (UTC). */
export function academicYearStart(now: Date): Date {
  const year = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  return new Date(Date.UTC(year, 8, 1))
}

/** Год выпуска текущего выпускного курса: после 1 сентября считается следующий календарный. */
export function graduationYear(now: Date): number {
  return now.getUTCMonth() >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear()
}

/** Потери между соседними шагами воронки. */
export function dropoff(stages: Record<string, number>): Array<{ from: string; lost: number }> {
  const order = ['SUBMITTED', 'VIEWED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED']
  const out: Array<{ from: string; lost: number }> = []
  for (let i = 0; i < order.length - 1; i += 1) {
    const key = order[i] as string
    const next = order[i + 1] as string
    out.push({ from: key, lost: (stages[key] ?? 0) - (stages[next] ?? 0) })
  }
  return out
}
