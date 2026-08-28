import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { HealthIndicatorResult } from '@nestjs/terminus'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import { QUEUE_NAMES, QueueService, type QueueCounts, type QueueName } from '../../common/queue'
import { HttpStatusCounter } from '../../common/monitoring'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PrismaHealthIndicator } from '../health/indicators/prisma.health'
import { RedisHealthIndicator } from '../health/indicators/redis.health'
import { MinioHealthIndicator } from '../health/indicators/minio.health'
import { ApplicationsService } from '../application-services/applications.service'
import { CleanupService } from '../cleanup/cleanup.service'
import { ComplaintsService } from '../complaints/complaints.service'
import { FileService } from '../files/file.service'
import { InviteService } from '../invites/invites.service'
import { PushService } from '../push/push.service'
import { UserService } from '../users/users.service'
import type { EnvVars } from '../../config/env.schema'

// Единственный источник метрик служебного канала (docs/TELEGRAM_BOT.md §7.1.5).
//
// `/status`, закреплённое сообщение и вечерняя сводка берут числа отсюда. Иначе каждая из
// трёх поверхностей посчитала бы своё, и на вопрос «почему в закреплённом 12, а в сводке 9»
// не нашлось бы ответа.
//
// Состояние зависимостей — из существующих health-индикаторов, а не своими запросами
// к Postgres и MinIO: тогда `GET /health` и канал отвечают на один вопрос одинаково.

export interface DependencyStatus {
  name: string
  up: boolean
  /** Причина недоступности; пустая строка, когда всё хорошо. */
  reason: string
}

export interface QueueStatus extends QueueCounts {
  name: QueueName
}

/** Строка «топ таблиц по объёму» суточной сводки. */
export interface TableSize {
  table: string
  bytes: number
}

export interface DatabaseStats {
  totalBytes: number
  topTables: TableSize[]
  /** Прирост общего объёма к замеру недельной давности; `null` — базы ещё нет. */
  weekDeltaBytes: number | null
}

export interface DigestSnapshot {
  database: DatabaseStats
  storage: { bucket: string; files: number; bytes: number }[]
  orphansRemoved: number | null
  push: { sent: number; gone: number; goneShare: number }
  /** Очереди дел, а не техники: сколько задач ждёт человека дольше SLA. */
  backlog: { complaints: number; applications: number; invites: number }
  activity: { active: number; registered: number; errorShare: number }
}

export interface OpsStatusSnapshot {
  /** Версия на проде: обычно git sha сборки. */
  release: string
  uptimeMs: number
  dependencies: DependencyStatus[]
  queues: QueueStatus[]
  checkedAt: Date
}

@Injectable()
export class OpsStatusService {
  private readonly logger = new Logger(OpsStatusService.name)
  private readonly startedAt = Date.now()

  constructor(
    private readonly queue: QueueService,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly minioHealth: MinioHealthIndicator,
    // Ниже — владельцы чисел суточной сводки. Модуль спрашивает их, а не читает чужие
    // таблицы: иначе предметная область оказалась бы описана в двух местах (§7.3.6).
    private readonly prisma: PrismaService,
    private readonly statusCounter: HttpStatusCounter,
    private readonly files: FileService,
    private readonly cleanup: CleanupService,
    private readonly push: PushService,
    private readonly complaints: ComplaintsService,
    private readonly applications: ApplicationsService,
    private readonly invites: InviteService,
    private readonly users: UserService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Полный снимок для закреплённого сообщения и `/status`. */
  async snapshot(): Promise<OpsStatusSnapshot> {
    const [dependencies, queues] = await Promise.all([this.dependencies(), this.queues()])
    return {
      release: this.config.get('SENTRY_RELEASE', { infer: true }) ?? 'dev',
      uptimeMs: Date.now() - this.startedAt,
      dependencies,
      queues,
      checkedAt: new Date(),
    }
  }

  /**
   * Суточная сводка (§2.3). Каждое число берётся у владельца данных: `ops-notify` не знает,
   * что такое жалоба или заявка, и не ходит в чужие таблицы (§7.3.6, BACKEND_RULES §2.1).
   * Исключение — размер БД: `pg_catalog` ничей, и спрашивать о нём некого.
   *
   * Источники независимы: упавший MinIO не должен оставить сводку без строки про заявки,
   * поэтому каждый блок отдаёт дефолт при сбое.
   */
  async digest(): Promise<DigestSnapshot> {
    const now = Date.now()
    const staleApplications = new Date(now - APPLICATION_SLA_DAYS * DAY_MS)
    const staleComplaints = new Date(now - COMPLAINT_SLA_DAYS * DAY_MS)
    const staleInvites = new Date(now - INVITE_SLA_DAYS * DAY_MS)
    const dayAgo = new Date(now - DAY_MS)

    const [
      database,
      storage,
      orphansRemoved,
      push,
      complaints,
      applications,
      invites,
      activity,
      errors,
    ] = await Promise.all([
      this.safe(() => this.databaseStats(), EMPTY_DATABASE),
      this.safe(() => this.files.storageStats(), []),
      this.safe(() => this.cleanup.lastOrphanSweep(), null),
      this.safe(() => this.push.deliveryStats(), { sent: 0, gone: 0, goneShare: 0 }),
      this.safe(() => this.complaints.staleCount(staleComplaints), 0),
      this.safe(() => this.applications.staleCount(staleApplications), 0),
      this.safe(() => this.invites.staleCount(staleInvites), 0),
      this.safe(() => this.users.activityStats(dayAgo), { active: 0, registered: 0 }),
      this.safe(() => this.statusCounter.errorRate(DAY_MINUTES), {
        total: 0,
        serverErrors: 0,
        share: 0,
      }),
    ])

    return {
      database,
      storage,
      orphansRemoved,
      push,
      backlog: { complaints, applications, invites },
      activity: { ...activity, errorShare: errors.share },
    }
  }

  /**
   * Размер БД и топ таблиц по объёму. Raw SQL неизбежен: `pg_catalog` в схеме Prisma нет.
   * Дельта считается к замеру недельной давности, который кладём сюда же — на Railway
   * есть лимиты, и упираться в них лучше заранее.
   */
  private async databaseStats(): Promise<DatabaseStats> {
    const rows = await this.prisma.$queryRaw<{ table: string; bytes: bigint }[]>`
      SELECT relname AS table, pg_total_relation_size(c.oid) AS bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY bytes DESC
      LIMIT ${TOP_TABLES}
    `
    const totals = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT pg_database_size(current_database()) AS total
    `
    const totalBytes = Number(totals[0]?.total ?? 0)
    return {
      totalBytes,
      topTables: rows.map((row) => ({ table: row.table, bytes: Number(row.bytes) })),
      weekDeltaBytes: await this.weekDelta(totalBytes),
    }
  }

  /**
   * Прирост к замеру недельной давности. База обновляется не чаще раза в неделю (`SET NX`
   * с недельным TTL): перезаписывай мы её каждый вечер, «дельта к неделе» превратилась бы
   * в «дельту к вчера» и перестала показывать тренд.
   */
  private async weekDelta(totalBytes: number): Promise<number | null> {
    try {
      const previous = await this.redis.get(DB_BASELINE_KEY)
      await this.redis.set(DB_BASELINE_KEY, String(totalBytes), 'EX', WEEK_SEC, 'NX')
      return previous === null ? null : totalBytes - Number(previous)
    } catch {
      return null
    }
  }

  /** Сбой одного источника не должен оставить сводку без остальных строк. */
  private async safe<T>(read: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await read()
    } catch (error) {
      this.logger.warn(`Источник сводки недоступен: ${String(error)}`)
      return fallback
    }
  }

  async dependencies(): Promise<DependencyStatus[]> {
    return Promise.all([
      this.probe('postgres', () => this.prismaHealth.isHealthy('database')),
      this.probe('redis', () => this.redisHealth.isHealthy('redis')),
      this.probe('minio', () => this.minioHealth.isHealthy('minio')),
    ])
  }

  /**
   * Глубина всех очередей. Недоступная очередь не роняет остальные: её счётчики приходят
   * нулями с пометкой в логе — молчащая строка лучше пустого снимка целиком.
   */
  async queues(): Promise<QueueStatus[]> {
    return Promise.all(
      QUEUE_NAMES.map(async (name) => {
        try {
          return { name, ...(await this.queue.counts(name)) }
        } catch (error) {
          this.logger.warn(`Не удалось прочитать очередь ${name}: ${String(error)}`)
          return { name, waiting: 0, active: 0, delayed: 0, failed: 0 }
        }
      }),
    )
  }

  private async probe(
    name: string,
    check: () => Promise<HealthIndicatorResult>,
  ): Promise<DependencyStatus> {
    try {
      const entry = Object.values(await check())[0]
      return {
        name,
        up: entry?.status === 'up',
        reason: typeof entry?.message === 'string' ? entry.message : '',
      }
    } catch (error) {
      // Индикатор может и бросить — для нас это то же самое «недоступна».
      return { name, up: false, reason: String(error) }
    }
  }
}

// Пороги «зависшего» — из §2.3: жалобы и заявки дольше трёх суток, инвайты дольше недели.
// Живут константами, а не в env: это описание сервиса, а не ручка для подкрутки.
const COMPLAINT_SLA_DAYS = 3
const APPLICATION_SLA_DAYS = 3
const INVITE_SLA_DAYS = 7

const TOP_TABLES = 5
const DAY_MS = 24 * 60 * 60 * 1000
const DAY_MINUTES = 24 * 60
const WEEK_SEC = 7 * 24 * 60 * 60
const DB_BASELINE_KEY = 'ops:db:size:week'

const EMPTY_DATABASE: DatabaseStats = { totalBytes: 0, topTables: [], weekDeltaBytes: null }
