import { Inject, Injectable } from '@nestjs/common'
import type Redis from 'ioredis'
import { Role } from '@studenthub/shared-types'
import type { PlatformInterval } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { REDIS_CLIENT } from '../../common/redis/redis.module'

// Аналитика платформы: read-only агрегаты по всем вузам для дашборда PLATFORM_ADMIN.
// Скоупа нет — роль уже гейтится @Roles на контроллере, платформенные роли видят всё.
//
// Все ряды считаются в SQL (date_trunc / FILTER / EXTRACT), а не в JS: выгружать
// таблицы в процесс, чтобы посчитать COUNT, запрещено (BACKEND_RULES §7.2 — findMany
// без take). Raw SQL — только $queryRaw с параметрами (§4.4), конкатенации нет.
//
// Каждый агрегат кэшируется в Redis (§«кэш для дорогих read-only агрегатов»):
// дашборд открывают часто, а данные меняются медленно.

const CACHE_TTL_SECONDS = 300
const DEFAULT_RANGE_DAYS = 30
/** Точек в спарклайне плитки. */
const SPARK_DAYS = 14
/** Потолок на список вузов в разрезе размеров. */
const UNIVERSITIES_LIMIT = 200
const DEFAULT_TOP_ACTIONS = 8
/** Зона раскладки часов, если клиент свою не прислал. */
const DEFAULT_TIME_ZONE = 'UTC'
const DAY_MS = 24 * 60 * 60 * 1000

/** Группы ролей для ряда «рост пользователей»: 8 ролей в легенду не влезают. */
const STUDENT_ROLES: Role[] = [Role.STUDENT, Role.STAROSTA]

export interface Bucket {
  /** Начало корзины, ISO. */
  at: string
  value: number
}

export interface MultiSeries {
  interval: PlatformInterval
  from: string
  to: string
  series: { key: string; points: Bucket[] }[]
}

export interface PlatformOverview {
  universities: { active: number; pending: number; blocked: number }
  users: { total: number; spark: number[] }
  complaints: { pending: number; spark: number[] }
  /** Медиана времени разбора жалобы, часы. null — за период не разобрали ни одной. */
  resolutionHours: { median: number | null; previousMedian: number | null }
  activeUsers: { dau: number; wau: number; spark: number[] }
}

interface RangeInput {
  from?: Date
  to?: Date
  interval?: PlatformInterval
}

interface ActivityInput extends RangeInput {
  /** Зона, в которой раскладываются часы. IANA-имя, по умолчанию UTC. */
  tz?: string
}

export interface ActivityGrid {
  from: string
  to: string
  /** Зона раскладки — эхом, чтобы подпись оси не расходилась с данными. */
  tz: string
  /** cells[dow][hour], dow: 0 = понедельник. */
  cells: number[][]
  /**
   * Сколько КАЛЕНДАРНЫХ дат каждого дня недели попало в период. Без этого
   * будни и выходные не сравнить: в 30-дневном окне понедельников пять, а суббот
   * четыре, и «в субботу событий меньше» означало бы лишь «суббот было меньше».
   */
  days: number[]
  max: number
}

interface ResolvedRange {
  from: Date
  to: Date
  interval: PlatformInterval
}

@Injectable()
export class PlatformAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Плитки дашборда: текущие значения + спарклайны за две недели. */
  overview(): Promise<PlatformOverview> {
    return this.cached('overview', {}, async () => {
      const now = new Date()
      const dayAgo = shiftDays(now, -1)
      const weekAgo = shiftDays(now, -7)
      const sparkFrom = startOfUtcDay(shiftDays(now, -(SPARK_DAYS - 1)))
      const monthAgo = shiftDays(now, -DEFAULT_RANGE_DAYS)
      const twoMonthsAgo = shiftDays(now, -DEFAULT_RANGE_DAYS * 2)

      const [
        universities,
        usersTotal,
        complaintsPending,
        usersSpark,
        complaintsSpark,
        activeSpark,
        dau,
        wau,
        median,
        previousMedian,
      ] = await Promise.all([
        this.prisma.university.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.user.count({ where: { deletedAt: null } }),
        this.prisma.complaint.count({ where: { status: { in: ['PENDING', 'REVIEWING'] } } }),
        this.dailyCounts('users', sparkFrom, now),
        this.dailyCounts('complaints', sparkFrom, now),
        this.dailyCounts('active-users', sparkFrom, now),
        this.distinctActors(dayAgo, now),
        this.distinctActors(weekAgo, now),
        this.medianResolutionHours(monthAgo, now),
        this.medianResolutionHours(twoMonthsAgo, monthAgo),
      ])

      const byStatus = (status: string): number =>
        universities.find((u) => u.status === status)?._count._all ?? 0

      return {
        universities: {
          active: byStatus('ACTIVE'),
          pending: byStatus('PENDING'),
          blocked: byStatus('BLOCKED'),
        },
        users: { total: usersTotal, spark: toSparkline(usersSpark, sparkFrom, SPARK_DAYS) },
        complaints: {
          pending: complaintsPending,
          spark: toSparkline(complaintsSpark, sparkFrom, SPARK_DAYS),
        },
        resolutionHours: { median, previousMedian },
        activeUsers: { dau, wau, spark: toSparkline(activeSpark, sparkFrom, SPARK_DAYS) },
      }
    })
  }

  /**
   * Рост пользователей: сколько зарегистрировалось за корзину, тремя группами ролей.
   * Именно новые за период, а не накопленный итог — иначе линия всегда растёт
   * и по ней не видно, замедлился ли приток.
   */
  usersGrowth(input: RangeInput): Promise<MultiSeries> {
    const range = resolveRange(input)
    return this.cached('users-growth', range, async () => {
      // Группы ролей — статические литералы enum'а, не пользовательский ввод.
      const rows = await this.prisma.$queryRaw<{ bucket: Date; series: string; count: bigint }[]>`
        SELECT date_trunc(${range.interval}::text, created_at) AS bucket,
               CASE
                 WHEN role IN ('STUDENT', 'STAROSTA') THEN 'students'
                 WHEN role = 'TEACHER' THEN 'teachers'
                 ELSE 'staff'
               END AS series,
               COUNT(*) AS count
          FROM users
         WHERE deleted_at IS NULL
           AND created_at >= ${range.from}
           AND created_at < ${range.to}
         GROUP BY 1, 2
         ORDER BY 1
      `
      return buildMultiSeries(rows, range, ['students', 'teachers', 'staff'])
    })
  }

  /**
   * DAU/WAU по журналу аудита: COUNT(DISTINCT user_id) за корзину и за скользящие 7 дней.
   *
   * Источник — audit_logs, а НЕ users.last_seen_at: last_seen_at перезаписывается при
   * каждом уходе в оффлайн (realtime.gateway), то есть хранит только последний момент —
   * исторический ряд из него не построить. Следствие: считаются пользователи, чьи
   * действия попадают в аудит.
   */
  activeUsers(input: RangeInput): Promise<MultiSeries> {
    const range = resolveRange(input)
    return this.cached('active-users', range, async () => {
      const rows = await this.prisma.$queryRaw<{ bucket: Date; series: string; count: bigint }[]>`
        WITH buckets AS (
          SELECT generate_series(
                   date_trunc(${range.interval}::text, ${range.from}::timestamptz),
                   date_trunc(${range.interval}::text, ${range.to}::timestamptz),
                   ('1 ' || ${range.interval}::text)::interval
                 ) AS bucket
        )
        SELECT b.bucket,
               'dau' AS series,
               COUNT(DISTINCT a.user_id) AS count
          FROM buckets b
          LEFT JOIN audit_logs a
                 ON a.user_id IS NOT NULL
                AND a.created_at >= b.bucket
                AND a.created_at < b.bucket + ('1 ' || ${range.interval}::text)::interval
         GROUP BY b.bucket
        UNION ALL
        SELECT b.bucket,
               'wau' AS series,
               COUNT(DISTINCT a.user_id) AS count
          FROM buckets b
          LEFT JOIN audit_logs a
                 ON a.user_id IS NOT NULL
                AND a.created_at >= b.bucket - interval '6 days'
                AND a.created_at < b.bucket + ('1 ' || ${range.interval}::text)::interval
         GROUP BY b.bucket
         ORDER BY 1
      `
      return buildMultiSeries(rows, range, ['dau', 'wau'])
    })
  }

  /** Размер вузов: студенты/преподаватели по каждому вузу, один запрос вместо N+1. */
  universitiesSize(): Promise<{
    items: {
      id: string
      name: string
      status: string
      students: number
      teachers: number
      total: number
    }[]
  }> {
    return this.cached('universities-size', {}, async () => {
      const [universities, grouped] = await Promise.all([
        this.prisma.university.findMany({
          select: { id: true, name: true, status: true },
          take: UNIVERSITIES_LIMIT,
          orderBy: { name: 'asc' },
        }),
        this.prisma.user.groupBy({
          by: ['universityId', 'role'],
          where: { deletedAt: null, universityId: { not: null } },
          _count: { _all: true },
        }),
      ])

      const items = universities.map((u) => {
        const mine = grouped.filter((g) => g.universityId === u.id)
        const countOf = (roles: Role[]): number =>
          mine.filter((g) => roles.includes(g.role)).reduce((sum, g) => sum + g._count._all, 0)
        const students = countOf(STUDENT_ROLES)
        const teachers = countOf([Role.TEACHER])
        return {
          id: u.id,
          name: u.name,
          status: u.status,
          students,
          teachers,
          total: mine.reduce((sum, g) => sum + g._count._all, 0),
        }
      })
      // Сортировка по убыванию: горизонтальный бар читается сверху вниз.
      items.sort((a, b) => b.total - a.total)
      return { items }
    })
  }

  /** Поток жалоб: поступило и разобрано за корзину — обе величины счётчики, одна ось. */
  complaintsFlow(input: RangeInput): Promise<MultiSeries> {
    const range = resolveRange(input)
    return this.cached('complaints-flow', range, async () => {
      const rows = await this.prisma.$queryRaw<{ bucket: Date; series: string; count: bigint }[]>`
        SELECT date_trunc(${range.interval}::text, created_at) AS bucket,
               'created' AS series,
               COUNT(*) AS count
          FROM complaints
         WHERE created_at >= ${range.from} AND created_at < ${range.to}
         GROUP BY 1
        UNION ALL
        SELECT date_trunc(${range.interval}::text, resolved_at) AS bucket,
               'resolved' AS series,
               COUNT(*) AS count
          FROM complaints
         WHERE resolved_at IS NOT NULL
           AND resolved_at >= ${range.from} AND resolved_at < ${range.to}
         GROUP BY 1
         ORDER BY 1
      `
      return buildMultiSeries(rows, range, ['created', 'resolved'])
    })
  }

  /**
   * Распределение времени разбора жалобы по корзинам + медиана.
   * Корзины неравные (час → сутки → неделя): интересна не средняя, а хвост.
   */
  complaintsLatency(input: RangeInput): Promise<{
    from: string
    to: string
    medianHours: number | null
    buckets: { key: string; value: number }[]
  }> {
    const range = resolveRange(input)
    return this.cached('complaints-latency', range, async () => {
      const rows = await this.prisma.$queryRaw<{ bucket: string; count: bigint }[]>`
        SELECT CASE
                 WHEN resolved_at - created_at < interval '1 hour'  THEN 'lt1h'
                 WHEN resolved_at - created_at < interval '4 hours' THEN 'lt4h'
                 WHEN resolved_at - created_at < interval '1 day'   THEN 'lt1d'
                 WHEN resolved_at - created_at < interval '3 days'  THEN 'lt3d'
                 WHEN resolved_at - created_at < interval '7 days'  THEN 'lt7d'
                 ELSE 'gte7d'
               END AS bucket,
               COUNT(*) AS count
          FROM complaints
         WHERE resolved_at IS NOT NULL
           AND resolved_at >= ${range.from} AND resolved_at < ${range.to}
         GROUP BY 1
      `
      const order = ['lt1h', 'lt4h', 'lt1d', 'lt3d', 'lt7d', 'gte7d']
      const found = new Map(rows.map((r) => [r.bucket, Number(r.count)]))
      return {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        medianHours: await this.medianResolutionHours(range.from, range.to),
        buckets: order.map((key) => ({ key, value: found.get(key) ?? 0 })),
      }
    })
  }

  /** Воронка инвайтов: конверсия в регистрацию + разбивка по статусам по корзинам. */
  invitesFunnel(input: RangeInput): Promise<{
    from: string
    to: string
    total: number
    used: number
    /** Доля использованных, проценты. */
    conversion: number
    byStatus: { key: string; value: number }[]
    series: MultiSeries
  }> {
    const range = resolveRange(input)
    return this.cached('invites-funnel', range, async () => {
      const statuses = ['USED', 'PENDING', 'EXPIRED', 'REVOKED']
      const [grouped, rows] = await Promise.all([
        this.prisma.invite.groupBy({
          by: ['status'],
          where: { createdAt: { gte: range.from, lt: range.to } },
          _count: { _all: true },
        }),
        this.prisma.$queryRaw<{ bucket: Date; series: string; count: bigint }[]>`
          SELECT date_trunc(${range.interval}::text, created_at) AS bucket,
                 status::text AS series,
                 COUNT(*) AS count
            FROM invites
           WHERE created_at >= ${range.from} AND created_at < ${range.to}
           GROUP BY 1, 2
           ORDER BY 1
        `,
      ])

      const countOf = (status: string): number =>
        grouped.find((g) => g.status === status)?._count._all ?? 0
      const total = grouped.reduce((sum, g) => sum + g._count._all, 0)
      const used = countOf('USED')

      return {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        total,
        used,
        conversion: total === 0 ? 0 : Math.round((used / total) * 100),
        byStatus: statuses.map((key) => ({ key, value: countOf(key) })),
        series: buildMultiSeries(rows, range, statuses),
      }
    })
  }

  /**
   * Активность по дням недели и часам (7×24) — когда платформа под нагрузкой.
   *
   * Часы раскладываются в зоне читателя (`tz`, по умолчанию UTC): единого «локального
   * часа» у платформы нет — у вузов свои зоны, — но и UTC-раскладка не читается:
   * «пик в 18» для Алматы означает 23:00, то есть рабочий день выглядит ночным.
   *
   * Вместе с сеткой отдаём `days` — число календарных дат каждого дня недели в
   * периоде. Это делитель, без которого дашборд сравнивал бы размер группы дней,
   * а не время активности.
   */
  activityHeatmap(input: ActivityInput): Promise<ActivityGrid> {
    const range = resolveRange(input)
    const tz = input.tz ?? DEFAULT_TIME_ZONE
    return this.cached('activity-heatmap', { ...range, tz }, async () => {
      // created_at — TIMESTAMP без зоны, в нём лежит UTC. Чтобы разложить события по
      // местным часам, зону сначала объявляют (AT TIME ZONE 'UTC' → timestamptz), и
      // только потом переводят в зону читателя. Один AT TIME ZONE сделал бы обратное:
      // объявил бы UTC-время местным.
      //
      // Границы периода при этом остаются прежними: `from`/`to` — абсолютные моменты,
      // зона на отбор строк не влияет, только на раскладку по dow/hour.
      const rows = await this.prisma.$queryRaw<{ dow: number; hour: number; count: bigint }[]>`
        SELECT EXTRACT(ISODOW FROM (created_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::int AS dow,
               EXTRACT(HOUR FROM (created_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::int AS hour,
               COUNT(*) AS count
          FROM audit_logs
         WHERE created_at >= ${range.from} AND created_at < ${range.to}
         GROUP BY 1, 2
      `
      const cells: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
      let max = 0
      for (const row of rows) {
        // ISODOW: 1 = понедельник … 7 = воскресенье.
        const day = cells[row.dow - 1]
        if (!day) continue
        const value = Number(row.count)
        day[row.hour] = value
        if (value > max) max = value
      }
      return {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        tz,
        cells,
        days: countDaysByWeekday(range.from, range.to, tz),
        max,
      }
    })
  }

  /** Топ действий в аудите за период. */
  topActions(input: RangeInput & { limit?: number }): Promise<{
    from: string
    to: string
    items: { action: string; value: number }[]
  }> {
    const range = resolveRange(input)
    const limit = input.limit ?? DEFAULT_TOP_ACTIONS
    return this.cached('top-actions', { ...range, limit }, async () => {
      const grouped = await this.prisma.auditLog.groupBy({
        by: ['action'],
        where: { createdAt: { gte: range.from, lt: range.to } },
        _count: { _all: true },
        orderBy: { _count: { action: 'desc' } },
        take: limit,
      })
      return {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        items: grouped.map((g) => ({ action: g.action, value: g._count._all })),
      }
    })
  }

  // ── Внутреннее ─────────────────────────────────────────────────────────────

  /** Медиана (resolved_at − created_at) в часах через percentile_cont. */
  private async medianResolutionHours(from: Date, to: Date): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<{ median: number | null }[]>`
      SELECT percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600
             ) AS median
        FROM complaints
       WHERE resolved_at IS NOT NULL
         AND resolved_at >= ${from} AND resolved_at < ${to}
    `
    const median = rows[0]?.median
    return median == null ? null : Math.round(median * 10) / 10
  }

  /** Уникальные пользователи с действиями в аудите за интервал. */
  private async distinctActors(from: Date, to: Date): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT user_id) AS count
        FROM audit_logs
       WHERE user_id IS NOT NULL
         AND created_at >= ${from} AND created_at < ${to}
    `
    return Number(rows[0]?.count ?? 0)
  }

  /** Дневные счётчики для спарклайна плитки. */
  private async dailyCounts(
    kind: 'users' | 'complaints' | 'active-users',
    from: Date,
    to: Date,
  ): Promise<{ bucket: Date; count: bigint }[]> {
    if (kind === 'users') {
      return this.prisma.$queryRaw`
        SELECT date_trunc('day', created_at) AS bucket, COUNT(*) AS count
          FROM users
         WHERE deleted_at IS NULL AND created_at >= ${from} AND created_at < ${to}
         GROUP BY 1 ORDER BY 1
      `
    }
    if (kind === 'complaints') {
      return this.prisma.$queryRaw`
        SELECT date_trunc('day', created_at) AS bucket, COUNT(*) AS count
          FROM complaints
         WHERE created_at >= ${from} AND created_at < ${to}
         GROUP BY 1 ORDER BY 1
      `
    }
    return this.prisma.$queryRaw`
      SELECT date_trunc('day', created_at) AS bucket, COUNT(DISTINCT user_id) AS count
        FROM audit_logs
       WHERE user_id IS NOT NULL AND created_at >= ${from} AND created_at < ${to}
       GROUP BY 1 ORDER BY 1
    `
  }

  /** Обёртка кэша: ключ включает параметры, иначе разные периоды затирали бы друг друга. */
  private async cached<T>(name: string, params: object, compute: () => Promise<T>): Promise<T> {
    const key = `analytics:platform:${name}:${stableKey(params)}`
    try {
      const hit = await this.redis.get(key)
      if (hit) return JSON.parse(hit) as T
    } catch {
      // Redis недоступен — считаем напрямую. Молча неработающий дашборд хуже,
      // чем дашборд без кэша.
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

function stableKey(params: object): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v instanceof Date ? v.toISOString() : String(v)}`)
    .sort()
  return entries.length ? entries.join('&') : 'all'
}

function shiftDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000)
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function resolveRange(input: RangeInput): ResolvedRange {
  const to = input.to ?? new Date()
  const from = input.from ?? shiftDays(to, -DEFAULT_RANGE_DAYS)
  return { from, to, interval: input.interval ?? 'day' }
}

/**
 * Раскладывает плоские строки SQL в ряды с полными корзинами: без досыпки нулей
 * график рвётся на днях без событий, а не показывает провал.
 */
function buildMultiSeries(
  rows: { bucket: Date; series: string; count: bigint }[],
  range: ResolvedRange,
  keys: string[],
): MultiSeries {
  const buckets = enumerateBuckets(range)
  const byKey = new Map<string, Map<number, number>>(keys.map((k) => [k, new Map()]))
  for (const row of rows) {
    const target = byKey.get(row.series)
    if (!target) continue
    target.set(row.bucket.getTime(), Number(row.count))
  }
  return {
    interval: range.interval,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    series: keys.map((key) => ({
      key,
      points: buckets.map((at) => ({
        at: at.toISOString(),
        value: byKey.get(key)?.get(at.getTime()) ?? 0,
      })),
    })),
  }
}

/** Границы корзин периода — те же, что даёт date_trunc в SQL (UTC). */
function enumerateBuckets(range: ResolvedRange): Date[] {
  const out: Date[] = []
  let cursor = truncate(range.from, range.interval)
  // Потолок на всякий случай: пользователь может прислать from за 1970 год.
  const MAX_BUCKETS = 1000
  while (cursor < range.to && out.length < MAX_BUCKETS) {
    out.push(cursor)
    cursor = advance(cursor, range.interval)
  }
  return out
}

function truncate(date: Date, interval: PlatformInterval): Date {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  const d = date.getUTCDate()
  if (interval === 'month') return new Date(Date.UTC(y, m, 1))
  if (interval === 'week') {
    // ISO-неделя: date_trunc('week') в Postgres начинает неделю с понедельника.
    const day = new Date(Date.UTC(y, m, d))
    const shift = (day.getUTCDay() + 6) % 7
    return new Date(day.getTime() - shift * 24 * 60 * 60 * 1000)
  }
  return new Date(Date.UTC(y, m, d))
}

function advance(date: Date, interval: PlatformInterval): Date {
  if (interval === 'month') {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
  }
  return shiftDays(date, interval === 'week' ? 7 : 1)
}

/**
 * Сколько календарных дат каждого дня недели попало в полуинтервал [from, to)
 * в зоне `tz`. Нужно, чтобы сравнивать будни с выходными: без делителя ряд
 * показывает не «когда активнее», а «каких дней в окне было больше».
 *
 * Считается по календарным ДАТАМ, а не по часам: переход на летнее время делает
 * сутки в 23 или 25 часов, но дат от этого не прибавляется и не убавляется.
 * Границы берутся форматтером зоны, дальше даты перебираются в UTC-пространстве —
 * там сутки ровно 24 часа и арифметика точна.
 */
export function countDaysByWeekday(from: Date, to: Date, tz: string): number[] {
  const days = Array.from({ length: 7 }, () => 0)
  if (!(to > from)) return days
  // en-CA даёт ISO-порядок YYYY-MM-DD — его можно разобрать без разбора частей.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  // Правый край полуинтервала исключающий: последняя дата периода — та, в которую
  // попала последняя его миллисекунда, иначе полночь добавляла бы лишние сутки.
  const first = utcDate(fmt.format(from))
  const last = utcDate(fmt.format(new Date(to.getTime() - 1)))
  if (first === null || last === null) return days
  // Потолок — тот же, что у корзин: клиент может прислать `from` за 1970 год.
  const MAX_DAYS = 1000
  for (let cursor = first, i = 0; cursor <= last && i < MAX_DAYS; cursor += DAY_MS, i += 1) {
    // getUTCDay(): 0 = воскресенье; в сетке 0 = понедельник.
    const dow = (new Date(cursor).getUTCDay() + 6) % 7
    days[dow] = (days[dow] ?? 0) + 1
  }
  return days
}

/** «2026-08-14» → полночь этой даты в UTC. null — формат не разобран. */
function utcDate(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** Спарклайн: ровно `days` значений, дни без событий — нули. */
function toSparkline(rows: { bucket: Date; count: bigint }[], from: Date, days: number): number[] {
  const found = new Map(rows.map((r) => [startOfUtcDay(r.bucket).getTime(), Number(r.count)]))
  return Array.from({ length: days }, (_, i) => found.get(shiftDays(from, i).getTime()) ?? 0)
}
