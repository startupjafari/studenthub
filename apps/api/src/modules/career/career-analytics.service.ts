import { Inject, Injectable } from '@nestjs/common'
import type Redis from 'ioredis'
import { resolveUniversityScope } from './career-scope'
import { PrismaService } from '../../common/prisma/prisma.service'
import { REDIS_CLIENT } from '../../common/redis/redis.module'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { CareerAccessService } from './career-access.service'

/**
 * Метрики карьерного модуля.
 *
 * Считаются агрегатами — ни один запрос здесь не возвращает персональные данные. Это
 * важно именно для карьеры: вуз имеет право видеть, как идёт трудоустройство, но не
 * должен через «аналитику» получать список студентов, скрывших профиль.
 */

/**
 * Шаги воронки по возрастанию глубины. REJECTED и WITHDRAWN сюда не входят намеренно:
 * это не шаги, а выходы — отклик мог дойти до интервью и получить отказ, и в воронке он
 * обязан остаться на интервью.
 */
const FUNNEL_STAGES = ['SUBMITTED', 'VIEWED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED'] as const
type FunnelStage = (typeof FUNNEL_STAGES)[number]

/** Глубина ряда «отклики по неделям». Семестр помещается целиком. */
const WEEKS = 12
/** Отклик без реакции компании дольше этого срока — повод для разговора с работодателем. */
const STALE_DAYS = 14
/** Горизонт «допуск скоро истечёт»: месяц — успеть продлить без спешки. */
const EXPIRING_DAYS = 30
/** Сколько навыков показываем в разрезе спроса и предложения. */
const SKILLS_LIMIT = 8
/**
 * Кэш сводки. Минута, а не пять: в сводке есть очередь модерации, и сотрудник,
 * разобравший заявку, должен увидеть это почти сразу.
 */
const CACHE_TTL_SECONDS = 60

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

@Injectable()
export class CareerAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CareerAccessService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Сводка по своему вузу: компании, вакансии, воронка, очередь и динамика. */
  async forUniversity(viewer: JwtPayload, universityIdParam?: string) {
    const universityId = resolveUniversityScope(viewer, universityIdParam)
    return this.cached(universityId, () => this.computeUniversity(universityId))
  }

  private async computeUniversity(universityId: string) {
    const now = new Date()

    const [companies, vacancyReviews, applications, profiles, studentsTotal] = await Promise.all([
      this.prisma.companyUniversityAccess.groupBy({
        by: ['status'],
        where: { universityId },
        _count: { _all: true },
      }),
      this.prisma.vacancyUniversityReview.groupBy({
        by: ['status'],
        where: { universityId },
        _count: { _all: true },
      }),
      this.prisma.careerApplication.groupBy({
        by: ['status'],
        where: { universityId },
        _count: { _all: true },
      }),
      this.prisma.careerProfile.count({
        where: { visibility: 'EMPLOYERS', user: { universityId, deletedAt: null } },
      }),
      this.prisma.user.count({ where: { universityId, role: 'STUDENT', deletedAt: null } }),
    ])

    const [reached, queue, weekly, skills] = await Promise.all([
      this.reachedStages(universityId),
      this.queue(universityId, now),
      this.weekly(universityId),
      this.skillsGap(universityId, studentsTotal),
    ])

    const submitted = reached.SUBMITTED

    return {
      companies: this.toMap(companies),
      vacancies: this.toMap(vacancyReviews),
      // Текущие статусы: сколько откликов сейчас лежит в каждом состоянии, включая
      // отказы и отзывы. Для воронки они не годятся — для остатков и итогов годятся.
      funnel: this.toMap(applications),
      // Сколько откликов ДОШЛО до шага. Это и есть воронка.
      reached,
      queue,
      weekly,
      skills,
      profiles: {
        // Сколько студентов вообще открыли себя работодателям — базовая метрика модуля.
        visible: profiles,
        total: studentsTotal,
      },
      // Доли считаем здесь, а не на фронте: одна формула на все экраны и отчёты.
      rates: {
        interview: this.rate(reached.INTERVIEW, submitted),
        offer: this.rate(reached.OFFER, submitted),
        hired: this.rate(reached.HIRED, submitted),
      },
    }
  }

  /**
   * Воронка по журналу переходов, а не по текущему статусу.
   *
   * Группировка по `status` отвечает на вопрос «где отклик лежит сейчас»: нанятый
   * студент виден только в HIRED и не попадает в «отправлено», а отказ после интервью
   * исчезает из воронки целиком. Поэтому глубина считается по максимуму из текущего
   * статуса и всех записанных переходов (CareerApplicationEvent), а ряд строится
   * накопительно: дошедший до оффера посчитан и на интервью, даже если VIEWED пропустили
   * (переход SUBMITTED → SHORTLISTED разрешён контрактом).
   */
  private async reachedStages(universityId: string): Promise<Record<FunnelStage, number>> {
    const rows = await this.prisma.$queryRaw<Array<Record<Lowercase<FunnelStage>, bigint>>>`
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
    const row = rows[0]
    return Object.fromEntries(
      FUNNEL_STAGES.map((stage) => [
        stage,
        Number(row?.[stage.toLowerCase() as Lowercase<FunnelStage>] ?? 0),
      ]),
    ) as Record<FunnelStage, number>
  }

  /**
   * Очередь и сроки: то, на что сотрудник вуза может повлиять сегодня.
   * «2 на модерации» само по себе ничего не говорит — важно, сколько дней ждёт
   * старейшая заявка и не истекает ли допуск у компании, которая исправно нанимает.
   */
  private async queue(universityId: string, now: Date) {
    const [pending, oldest, decision, requested, expiring, stale] = await Promise.all([
      this.prisma.vacancyUniversityReview.count({ where: { universityId, status: 'PENDING' } }),
      this.prisma.vacancyUniversityReview.findFirst({
        where: { universityId, status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.$queryRaw<Array<{ median: number | null }>>`
        SELECT percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY EXTRACT(EPOCH FROM (decided_at - created_at)) / 3600
               ) AS median
          FROM vacancy_university_reviews
         WHERE university_id = ${universityId}
           AND decided_at IS NOT NULL
           -- Решение раньше заявки — испорченная запись (в сиде такие есть). Считать её
           -- нельзя: одна отрицательная длительность утаскивает медиану ниже нуля, и
           -- панель показывает «медиана решения — −336 ч».
           AND decided_at >= created_at
           AND decided_at >= ${new Date(now.getTime() - 90 * DAY_MS)}
      `,
      this.prisma.companyUniversityAccess.count({ where: { universityId, status: 'REQUESTED' } }),
      this.prisma.companyUniversityAccess.count({
        where: {
          universityId,
          status: 'APPROVED',
          expiresAt: { gte: now, lte: new Date(now.getTime() + EXPIRING_DAYS * DAY_MS) },
        },
      }),
      this.prisma.careerApplication.count({
        where: {
          universityId,
          status: { in: ['SUBMITTED', 'VIEWED'] },
          updatedAt: { lt: new Date(now.getTime() - STALE_DAYS * DAY_MS) },
        },
      }),
    ])

    const median = decision[0]?.median
    return {
      vacanciesPending: pending,
      // Прочерк вместо нуля: «очередь пуста» и «ждут ноль дней» — разные вещи.
      oldestPendingDays: oldest
        ? Math.floor((now.getTime() - oldest.createdAt.getTime()) / DAY_MS)
        : null,
      medianDecisionHours: median == null ? null : Math.round(Number(median)),
      companiesRequested: requested,
      accessExpiringSoon: expiring,
      staleApplications: stale,
      staleDays: STALE_DAYS,
      expiringDays: EXPIRING_DAYS,
    }
  }

  /**
   * Отклики, интервью и найм по неделям. Корзины досыпаются в SQL через generate_series:
   * без пустых недель линия рвётся на каникулах и читается как провал активности,
   * а не как отсутствие событий.
   */
  private async weekly(universityId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{ bucket: Date; submitted: bigint; interview: bigint; hired: bigint }>
    >`
      WITH weeks AS (
        SELECT generate_series(
                 date_trunc('week', now()) - make_interval(weeks => ${WEEKS - 1}::int),
                 date_trunc('week', now()),
                 interval '1 week'
               ) AS bucket
      )
      SELECT w.bucket,
             (SELECT COUNT(*) FROM career_applications a
               WHERE a.university_id = ${universityId}
                 AND a.created_at >= w.bucket
                 AND a.created_at < w.bucket + interval '1 week') AS submitted,
             (SELECT COUNT(DISTINCT e.application_id)
                FROM career_application_events e
                JOIN career_applications a ON a.id = e.application_id
               WHERE a.university_id = ${universityId}
                 AND e.to_status = 'INTERVIEW'
                 AND e.created_at >= w.bucket
                 AND e.created_at < w.bucket + interval '1 week') AS interview,
             (SELECT COUNT(DISTINCT e.application_id)
                FROM career_application_events e
                JOIN career_applications a ON a.id = e.application_id
               WHERE a.university_id = ${universityId}
                 AND e.to_status = 'HIRED'
                 AND e.created_at >= w.bucket
                 AND e.created_at < w.bucket + interval '1 week') AS hired
        FROM weeks w
       ORDER BY 1
    `
    return {
      weeks: rows.map((r) => r.bucket.toISOString()),
      submitted: rows.map((r) => Number(r.submitted)),
      interview: rows.map((r) => Number(r.interview)),
      hired: rows.map((r) => Number(r.hired)),
    }
  }

  /**
   * Дефицит навыков: чего требуют открытые студентам вакансии против того, что указали
   * у себя студенты вуза. Навыки лежат массивами (общий справочник skills.ts), поэтому
   * считаются через unnest, а не отдельной таблицей.
   *
   * Спрос берётся только по вакансиям, одобренным ЭТИМ вузом: требования компании,
   * которую вуз не пустил, к его студентам отношения не имеют.
   *
   * Кроме штук возвращаются доли: 2 вакансии и 296 студентов — величины разной природы,
   * и на одной шкале спрос превращается в невидимую полоску. Сравнимы именно доли —
   * «две трети вакансий требуют React, а указали его 0% студентов».
   */
  private async skillsGap(universityId: string, studentsTotal: number) {
    const rows = await this.prisma.$queryRaw<
      Array<{ skill: string; demand: bigint; supply: bigint; vacancies_total: bigint }>
    >`
      WITH demand AS (
        SELECT vs.skill AS skill, COUNT(*) AS n
          FROM vacancies v
          JOIN vacancy_university_reviews r
            ON r.vacancy_id = v.id
           AND r.university_id = ${universityId}
           AND r.status = 'APPROVED'
          CROSS JOIN LATERAL unnest(v.skills) AS vs(skill)
         WHERE v.deleted_at IS NULL AND v.status = 'PUBLISHED'
         GROUP BY 1
      ),
      supply AS (
        SELECT us.skill AS skill, COUNT(*) AS n
          FROM users u
          CROSS JOIN LATERAL unnest(u.skills) AS us(skill)
         WHERE u.university_id = ${universityId}
           AND u.role::text = 'STUDENT'
           AND u.deleted_at IS NULL
         GROUP BY 1
      ),
      base AS (
        SELECT COUNT(*) AS n
          FROM vacancies v
          JOIN vacancy_university_reviews r
            ON r.vacancy_id = v.id
           AND r.university_id = ${universityId}
           AND r.status = 'APPROVED'
         WHERE v.deleted_at IS NULL AND v.status = 'PUBLISHED'
      )
      SELECT d.skill, d.n AS demand, COALESCE(sp.n, 0) AS supply, b.n AS vacancies_total
        FROM demand d
        LEFT JOIN supply sp ON sp.skill = d.skill
        CROSS JOIN base b
       ORDER BY d.n DESC, d.skill
       LIMIT ${SKILLS_LIMIT}
    `
    return rows.map((r) => {
      const vacanciesTotal = Number(r.vacancies_total)
      return {
        skill: r.skill,
        demand: Number(r.demand),
        supply: Number(r.supply),
        demandShare: this.rate(Number(r.demand), vacanciesTotal),
        supplyShare: this.rate(Number(r.supply), studentsTotal),
      }
    })
  }

  /** Сводка по своей компании: что видит работодатель про собственный подбор. */
  async forCompany(viewer: JwtPayload) {
    const companyId = this.access.requireCompany(viewer)

    const [vacancies, applications, views] = await Promise.all([
      this.prisma.vacancy.groupBy({
        by: ['status'],
        where: { companyId, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.careerApplication.groupBy({
        by: ['status'],
        where: { companyId },
        _count: { _all: true },
      }),
      this.prisma.vacancy.aggregate({
        where: { companyId, deletedAt: null },
        _sum: { views: true },
      }),
    ])

    const funnel = this.toMap(applications)
    const total = Object.values(funnel).reduce((sum, n) => sum + n, 0)

    return {
      vacancies: this.toMap(vacancies),
      funnel,
      views: views._sum.views ?? 0,
      rates: {
        // Отклик на просмотр: показывает, работает ли текст вакансии.
        apply: this.rate(total, views._sum.views ?? 0),
        interview: this.rate(funnel.INTERVIEW ?? 0, total),
        hired: this.rate(funnel.HIRED ?? 0, total),
      },
    }
  }

  /**
   * Кэш сводки на минуту: экран открывают часто, а шесть агрегатов по всем откликам вуза
   * стоят дорого. Redis недоступен — считаем напрямую: дашборд без кэша лучше, чем
   * дашборд, молча переставший работать.
   */
  private async cached<T>(universityId: string, compute: () => Promise<T>): Promise<T> {
    const key = `analytics:career:university:${universityId}`
    try {
      const hit = await this.redis.get(key)
      if (hit) return JSON.parse(hit) as T
    } catch {
      // см. выше
    }
    const value = await compute()
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS)
    } catch {
      // см. выше
    }
    return value
  }

  /** groupBy → {статус: количество}. */
  private toMap(rows: Array<{ status: string; _count: { _all: number } }>): Record<string, number> {
    return Object.fromEntries(rows.map((row) => [row.status, row._count._all]))
  }

  /** Доля в процентах. Ноль в знаменателе — не ошибка, а «ещё нечего считать». */
  private rate(part: number, whole: number): number | null {
    if (whole === 0) return null
    return Math.round((part / whole) * 100)
  }
}
