import { Inject, Injectable } from '@nestjs/common'
import type Redis from 'ioredis'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { REDIS_CLIENT } from '../../common/redis/redis.module'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Аналитика вуза: read-only агрегаты для дашборда UNIVERSITY_ADMIN. Роль гейтится
// @Roles на контроллере, а scope — universityId из токена: вуз видит только себя.
//
// Все ряды считаются в SQL (date_trunc / FILTER / EXTRACT), а не в JS: выгружать
// таблицы в процесс ради COUNT запрещено (BACKEND_RULES §7.2). Raw SQL — только
// $queryRaw с параметрами (§4.4).
//
// Кэш в Redis: дашборд открывают часто, а посещаемость и расписание меняются медленно.

const CACHE_TTL_SECONDS = 300
/** Недель в рядах по неделям. 12 ≈ семестр, дальше линия становится нечитаемой. */
const DEFAULT_WEEKS = 12
const MAX_WEEKS = 52
/** Потолок на разрезы по факультетам: их у вуза единицы, но потолок обязателен. */
const FACULTY_LIMIT = 100
/** Пары начинаются не чаще, чем раз в час — в теплокарте 7 дней × 24 часа. */
const HOURS = 24
const DAYS = 7

export interface WeeklyPoint {
  /** Понедельник недели, ISO. */
  at: string
  value: number
}

export interface FacultySeries {
  facultyId: string
  name: string
  points: WeeklyPoint[]
}

@Injectable()
export class UniversityAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Динамика посещаемости по неделям, отдельным рядом на факультет.
   * Отвечает на «стало лучше или хуже» — срез на сегодня этого не показывает.
   */
  attendanceTrend(viewer: JwtPayload, weeks = DEFAULT_WEEKS) {
    const universityId = this.scope(viewer)
    const span = clampWeeks(weeks)
    return this.cached('attendance-trend', { universityId, span }, async () => {
      const from = startOfWeek(shiftDays(new Date(), -7 * (span - 1)))
      const rows = await this.prisma.$queryRaw<
        { faculty_id: string; name: string; bucket: Date; rate: number }[]
      >`
        SELECT f.id AS faculty_id,
               f.name,
               date_trunc('week', a.date) AS bucket,
               -- Доля не-пропусков: та же формула, что в обзоре факультета.
               ROUND(100.0 * COUNT(*) FILTER (WHERE a.status <> 'ABSENT') / COUNT(*))::int AS rate
          FROM attendance a
          JOIN pairs p ON p.id = a.pair_id
          JOIN groups g ON g.id = p.group_id
          JOIN faculties f ON f.id = g.faculty_id
         WHERE f.university_id = ${universityId}
           AND a.date >= ${from}
         GROUP BY 1, 2, 3
         ORDER BY 3
      `
      const byFaculty = new Map<string, FacultySeries>()
      for (const r of rows) {
        const cur = byFaculty.get(r.faculty_id) ?? {
          facultyId: r.faculty_id,
          name: r.name,
          points: [],
        }
        cur.points.push({ at: r.bucket.toISOString(), value: Number(r.rate) })
        byFaculty.set(r.faculty_id, cur)
      }
      return { weeks: span, from: from.toISOString(), series: [...byFaculty.values()] }
    })
  }

  /**
   * Структура посещаемости по факультетам: PRESENT · LATE · ABSENT · EXCUSED.
   * Один процент склеивает прогулы и опоздания, а это разные проблемы.
   */
  attendanceBreakdown(viewer: JwtPayload) {
    const universityId = this.scope(viewer)
    return this.cached('attendance-breakdown', { universityId }, async () => {
      const rows = await this.prisma.$queryRaw<
        {
          faculty_id: string
          name: string
          present: bigint
          late: bigint
          absent: bigint
          excused: bigint
        }[]
      >`
        SELECT f.id AS faculty_id,
               f.name,
               COUNT(*) FILTER (WHERE a.status = 'PRESENT') AS present,
               COUNT(*) FILTER (WHERE a.status = 'LATE')    AS late,
               COUNT(*) FILTER (WHERE a.status = 'ABSENT')  AS absent,
               COUNT(*) FILTER (WHERE a.status = 'EXCUSED') AS excused
          FROM attendance a
          JOIN pairs p ON p.id = a.pair_id
          JOIN groups g ON g.id = p.group_id
          JOIN faculties f ON f.id = g.faculty_id
         WHERE f.university_id = ${universityId}
         GROUP BY 1, 2
         ORDER BY 2
         LIMIT ${FACULTY_LIMIT}
      `
      return {
        items: rows.map((r) => ({
          facultyId: r.faculty_id,
          name: r.name,
          present: Number(r.present),
          late: Number(r.late),
          absent: Number(r.absent),
          excused: Number(r.excused),
        })),
      }
    })
  }

  /**
   * Загрузка аудиторий: сетка «день недели × час начала пары». Отвечает на вопрос
   * «хватает ли помещений» — им админ вуза и занимается.
   */
  roomLoad(viewer: JwtPayload) {
    const universityId = this.scope(viewer)
    return this.cached('room-load', { universityId }, async () => {
      const [rows, rooms] = await Promise.all([
        this.prisma.$queryRaw<{ day: number; hour: number; count: bigint }[]>`
          SELECT p.day_of_week AS day,
                 -- start_time хранится как "HH:mm" в таймзоне вуза — час берём из строки.
                 split_part(p.start_time, ':', 1)::int AS hour,
                 COUNT(*) AS count
            FROM pairs p
            JOIN rooms r ON r.id = p.room_id
           WHERE r.university_id = ${universityId}
           GROUP BY 1, 2
        `,
        this.prisma.room.count({ where: { universityId, kind: 'AUDITORIUM' } }),
      ])
      // Плотная матрица 7×24: фронту не нужно достраивать пустые ячейки.
      const grid = Array.from({ length: DAYS }, () => Array.from({ length: HOURS }, () => 0))
      let peak = 0
      for (const r of rows) {
        const day = r.day - 1
        if (day < 0 || day >= DAYS || r.hour < 0 || r.hour >= HOURS) continue
        const value = Number(r.count)
        grid[day]![r.hour] = value
        if (value > peak) peak = value
      }
      return { grid, peak, rooms }
    })
  }

  /**
   * Исход экзаменов по факультетам: PASSED · FAILED · ABSENT · RETAKE.
   * Плитка «экзаменов впереди» показывает количество, но не результат.
   */
  examResults(viewer: JwtPayload) {
    const universityId = this.scope(viewer)
    return this.cached('exam-results', { universityId }, async () => {
      const rows = await this.prisma.$queryRaw<
        {
          faculty_id: string
          name: string
          passed: bigint
          failed: bigint
          absent: bigint
          retake: bigint
        }[]
      >`
        SELECT f.id AS faculty_id,
               f.name,
               COUNT(*) FILTER (WHERE er.status = 'PASSED') AS passed,
               COUNT(*) FILTER (WHERE er.status = 'FAILED') AS failed,
               COUNT(*) FILTER (WHERE er.status = 'ABSENT') AS absent,
               COUNT(*) FILTER (WHERE er.status = 'RETAKE') AS retake
          FROM exam_results er
          JOIN exams e ON e.id = er.exam_id
          JOIN groups g ON g.id = e.group_id
          JOIN faculties f ON f.id = g.faculty_id
         WHERE f.university_id = ${universityId}
         GROUP BY 1, 2
         ORDER BY 2
         LIMIT ${FACULTY_LIMIT}
      `
      return {
        items: rows.map((r) => ({
          facultyId: r.faculty_id,
          name: r.name,
          passed: Number(r.passed),
          failed: Number(r.failed),
          absent: Number(r.absent),
          retake: Number(r.retake),
        })),
      }
    })
  }

  /**
   * Заявки по неделям: поступило и закрыто, плюс сколько закрыто с нарушением срока.
   * SLA услуг — то, за что вуз отвечает перед студентом.
   */
  applicationsFlow(viewer: JwtPayload, weeks = DEFAULT_WEEKS) {
    const universityId = this.scope(viewer)
    const span = clampWeeks(weeks)
    return this.cached('applications-flow', { universityId, span }, async () => {
      const from = startOfWeek(shiftDays(new Date(), -7 * (span - 1)))
      // Ряд по всем неделям окна, а не только по тем, где были заявки: иначе линия
      // «схлопывает» пустые недели и врёт про темп. Поступление и закрытие считаем
      // отдельными агрегатами и приклеиваем к календарю — join календаря напрямую к
      // заявкам дал бы декартово произведение недель на заявки.
      const rows = await this.prisma.$queryRaw<
        { bucket: Date; submitted: bigint; closed: bigint; overdue: bigint }[]
      >`
        WITH weeks AS (
          SELECT generate_series(
                   date_trunc('week', ${from}::timestamptz),
                   date_trunc('week', now()),
                   '1 week'::interval
                 ) AS bucket
        ),
        opened AS (
          SELECT date_trunc('week', submitted_at) AS bucket, COUNT(*) AS submitted
            FROM applications
           WHERE university_id = ${universityId}
             AND deleted_at IS NULL
             AND submitted_at >= ${from}
           GROUP BY 1
        ),
        done AS (
          -- Закрытием считаем готовность, а не выдачу: SLA услуги отмеряется до ready_at,
          -- а забрать бумажный оригинал студент может и через неделю.
          SELECT date_trunc('week', ready_at) AS bucket,
                 COUNT(*) AS closed,
                 COUNT(*) FILTER (WHERE due_at IS NOT NULL AND ready_at > due_at) AS overdue
            FROM applications
           WHERE university_id = ${universityId}
             AND deleted_at IS NULL
             AND ready_at IS NOT NULL
             AND ready_at >= ${from}
           GROUP BY 1
        )
        SELECT w.bucket,
               COALESCE(o.submitted, 0) AS submitted,
               COALESCE(d.closed, 0)    AS closed,
               COALESCE(d.overdue, 0)   AS overdue
          FROM weeks w
          LEFT JOIN opened o ON o.bucket = w.bucket
          LEFT JOIN done   d ON d.bucket = w.bucket
         ORDER BY w.bucket
      `
      return {
        weeks: span,
        points: rows.map((r) => ({
          at: r.bucket.toISOString(),
          submitted: Number(r.submitted),
          closed: Number(r.closed),
          overdue: Number(r.overdue),
        })),
      }
    })
  }

  /** Воронка приглашений вуза: выдано → принято, и сколько пропало (истекло/отозвано). */
  invitesFunnel(viewer: JwtPayload) {
    const universityId = this.scope(viewer)
    return this.cached('invites-funnel', { universityId }, async () => {
      const rows = await this.prisma.invite.groupBy({
        by: ['status'],
        where: { universityId },
        _count: { _all: true },
      })
      const by = (s: string): number => rows.find((r) => r.status === s)?._count._all ?? 0
      const used = by('USED')
      const total = rows.reduce((acc, r) => acc + r._count._all, 0)
      return {
        total,
        pending: by('PENDING'),
        used,
        expired: by('EXPIRED'),
        revoked: by('REVOKED'),
        // Конверсия считается от всех выданных, а не от закрытых: смысл воронки в том,
        // какая доля приглашений вообще довела человека до регистрации.
        conversion: total === 0 ? 0 : Math.round((used / total) * 100),
      }
    })
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Вуз берём из токена: параметром его принимать нельзя (§21 — scope не из тела запроса). */
  private scope(viewer: JwtPayload): string {
    if (!viewer.universityId) {
      throw new AppException('WRONG_SCOPE', 'Пользователь не привязан к вузу')
    }
    return viewer.universityId
  }

  private async cached<T>(name: string, params: object, compute: () => Promise<T>): Promise<T> {
    const key = `analytics:university:${name}:${stableKey(params)}`
    try {
      const hit = await this.redis.get(key)
      if (hit) return JSON.parse(hit) as T
    } catch {
      // Redis недоступен — считаем напрямую: дашборд без кэша лучше, чем без дашборда.
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
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${String(v)}`)
    .sort()
    .join('&')
}

function clampWeeks(weeks: number): number {
  if (!Number.isFinite(weeks)) return DEFAULT_WEEKS
  return Math.min(MAX_WEEKS, Math.max(1, Math.trunc(weeks)))
}

function shiftDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

/** Понедельник недели в UTC — та же граница, что у date_trunc('week', …) в Postgres. */
function startOfWeek(date: Date): Date {
  const next = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
  )
  // getUTCDay(): 0 = воскресенье. Приводим к ISO, где неделя начинается с понедельника.
  const iso = (next.getUTCDay() + 6) % 7
  next.setUTCDate(next.getUTCDate() - iso)
  return next
}
