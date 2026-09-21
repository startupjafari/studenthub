import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'
import { InviteStatus } from '@prisma/client'
import type { Client as MinioClient } from 'minio'
import type Redis from 'ioredis'
import { PrismaService } from '../../common/prisma/prisma.service'
import { MINIO_CLIENT } from '../../common/minio/minio.constants'
import { CronLockService } from '../../common/redis/cron-lock.service'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import type { EnvVars } from '../../config/env.schema'
import { EventsService } from '../events/events.service'
import { PostsService } from '../posts/posts.service'
import { DocumentsService } from '../documents/documents.service'
import { ChatsService } from '../chats/chats.service'
import { SupportService } from '../chats/support.service'
import { countServerErrors } from '../../common/monitoring/error-rate'
import { TelegramNotifyService } from '../../common/telegram/telegram-notify.service'
import { PLATFORM_STATE, type PlatformStateReader } from '../platform/platform.constants'

// Единственный дом для cron-задач (docs/PROJECT.md §10.2, docs/BACKEND_RULES.md §9.3).
// Разбрасывать @Cron по модулям запрещено. Все задачи работают батчами и логируют счётчик.
//
// Каждая задача идёт под Redis-локом (`CronLockService`): при нескольких инстансах API
// расписание живёт в каждом процессе и без лока задача стартует одновременно везде.
// Возврат `null` из метода = «лок занят, задача идёт на другом инстансе».
const BATCH_SIZE = 500

// Страховочные TTL локов: с запасом больше ожидаемой работы, но меньше интервала запуска
// (иначе следующий тик наткнётся на собственный несnятый лок).
const LOCK_TTL_MS = {
  scheduleEventReminders: 10 * 60 * 1000,
  publishScheduledPosts: 55 * 1000,
  deliverScheduledMessages: 55 * 1000,
  sweepDocumentExpiry: 15 * 60 * 1000,
  expireInvites: 10 * 60 * 1000,
  cleanOldNotifications: 30 * 60 * 1000,
  cleanAuditLogs: 30 * 60 * 1000,
  cleanOrphanFiles: 60 * 60 * 1000,
  sendDailyDigest: 10 * 60 * 1000,
  alertQueueBacklog: 10 * 60 * 1000,
  closeStaleTickets: 10 * 60 * 1000,
  watchServices: 4 * 60 * 1000,
} as const
const NOTIFICATION_RETENTION_DAYS = 30
const AUDIT_RETENTION_DAYS = 90
// Не трогаем свежие объекты MinIO — они могут быть в процессе загрузки (запись File ещё не создана).
const ORPHAN_SAFETY_MINUTES = 60

const DAY_MS = 24 * 60 * 60 * 1000

// Сигнал о накоплении очереди жалоб.
//
// Порог и пауза подобраны так, чтобы уведомление означало «очередь вышла из-под контроля»,
// а не «пришло ещё три жалобы». Сигналить на каждый час превышения бессмысленно: разгрести
// два десятка жалоб за час нельзя, и пять одинаковых сообщений подряд учат их не читать.
const QUEUE_BACKLOG_THRESHOLD = 20
const QUEUE_BACKLOG_SILENCE_SEC = 6 * 60 * 60
const QUEUE_BACKLOG_KEY = 'platform:queue-backlog-alerted'

// Через сколько молчания обращение закрывается само. Две недели — достаточно, чтобы
// человек успел вернуться с уточнением, и достаточно мало, чтобы очередь не превращалась
// в кладбище отвеченного.
const SUPPORT_STALE_DAYS = 14

// Наблюдение за зависимостями и ошибками.
//
// Сигналим только на ПЕРЕХОД: «упало» и «поднялось». Повторять «всё ещё лежит» каждые
// пять минут бессмысленно — починка идёт, а поток одинаковых сообщений учит их не читать.
const SERVICES_STATE_KEY = 'platform:services-down'
// Порог всплеска: столько серверных ошибок за час означает, что сломалось что-то общее,
// а не один запрос одного человека.
const ERROR_SPIKE_THRESHOLD = 25
const ERROR_SPIKE_KEY = 'platform:error-spike-alerted'
const ERROR_SPIKE_SILENCE_SEC = 60 * 60

// Итог ночной уборки сирот живёт двое суток: сводка читает его раз в день, и пропуск
// одного запуска не должен превращаться в пустую строку навсегда.

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MINIO_CLIENT) private readonly minio: MinioClient,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly events: EventsService,
    private readonly posts: PostsService,
    private readonly documents: DocumentsService,
    private readonly chats: ChatsService,
    private readonly locks: CronLockService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly support: SupportService,
    private readonly telegram: TelegramNotifyService,
    @Inject(PLATFORM_STATE) private readonly platform: PlatformStateReader,
  ) {}

  // Напоминания за час до события (docs/BACKEND_RULES.md §9.3): каждые 15 мин, окно [now+55, now+70],
  // дедуп через Event.reminderSentAt. Логика — в EventsService.remindDue (владелец домена).
  @Cron('*/15 * * * *', { name: 'scheduleEventReminders' })
  async scheduleEventReminders(): Promise<number | null> {
    return this.locks.run('scheduleEventReminders', LOCK_TTL_MS.scheduleEventReminders, () =>
      this.events.remindDue(),
    )
  }

  // Отложенная публикация постов: каждую минуту публикуем посты, у которых наступил scheduledAt.
  @Cron('* * * * *', { name: 'publishScheduledPosts' })
  async publishScheduledPosts(): Promise<number | null> {
    return this.locks.run('publishScheduledPosts', LOCK_TTL_MS.publishScheduledPosts, () =>
      this.posts.publishDueScheduled(),
    )
  }

  // Отложенные сообщения чатов — тем же минутным тиком, что и отложенные посты.
  // Расписание живёт здесь, а не в ChatsModule: разбрасывать @Cron по модулям запрещено (§9.3).
  @Cron('* * * * *', { name: 'deliverScheduledMessages' })
  async deliverScheduledMessages(): Promise<number | null> {
    return this.locks.run('deliverScheduledMessages', LOCK_TTL_MS.deliverScheduledMessages, () =>
      this.chats.deliverDueScheduled(),
    )
  }

  // Документы по сроку `expiresAt` → EXPIRING/EXPIRED + уведомления владельцам (§15.19).
  // Ежедневно в 03:30. Логика — в DocumentsService.sweepExpiry (владелец домена).
  @Cron('30 3 * * *', { name: 'sweepDocumentExpiry' })
  async sweepDocumentExpiry(): Promise<{ expired: number; expiring: number } | null> {
    return this.locks.run('sweepDocumentExpiry', LOCK_TTL_MS.sweepDocumentExpiry, () =>
      this.documents.sweepExpiry(),
    )
  }

  // Просроченные PENDING-инвайты → EXPIRED. Ежечасно.
  @Cron('0 * * * *', { name: 'expireInvites' })
  async expireInvites(): Promise<number | null> {
    return this.locks.run('expireInvites', LOCK_TTL_MS.expireInvites, () =>
      this.expireInvitesTask(),
    )
  }

  private async expireInvitesTask(): Promise<number> {
    const now = new Date()
    let total = 0
    for (;;) {
      const batch = await this.prisma.invite.findMany({
        where: { status: InviteStatus.PENDING, expiresAt: { lt: now } },
        select: { id: true },
        take: BATCH_SIZE,
      })
      if (batch.length === 0) break
      const { count } = await this.prisma.invite.updateMany({
        where: { id: { in: batch.map((b) => b.id) } },
        data: { status: InviteStatus.EXPIRED },
      })
      total += count
      if (batch.length < BATCH_SIZE) break
    }
    this.logger.log(`expireInvites: помечено EXPIRED ${total}`)
    return total
  }

  // Прочитанные уведомления старше 30 дней. Еженедельно (вс, 02:00).
  @Cron('0 2 * * 0', { name: 'cleanOldNotifications' })
  async cleanOldNotifications(): Promise<number | null> {
    return this.locks.run('cleanOldNotifications', LOCK_TTL_MS.cleanOldNotifications, () =>
      this.cleanOldNotificationsTask(),
    )
  }

  private async cleanOldNotificationsTask(): Promise<number> {
    const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * DAY_MS)
    const total = await this.deleteInBatches(
      () =>
        this.prisma.notification.findMany({
          where: { isRead: true, createdAt: { lt: cutoff } },
          select: { id: true },
          take: BATCH_SIZE,
        }),
      (ids) => this.prisma.notification.deleteMany({ where: { id: { in: ids } } }),
    )
    this.logger.log(`cleanOldNotifications: удалено ${total}`)
    return total
  }

  // AuditLog старше 90 дней. Раз в месяц (1-е число, 01:00).
  @Cron('0 1 1 * *', { name: 'cleanAuditLogs' })
  async cleanAuditLogs(): Promise<number | null> {
    return this.locks.run('cleanAuditLogs', LOCK_TTL_MS.cleanAuditLogs, () =>
      this.cleanAuditLogsTask(),
    )
  }

  private async cleanAuditLogsTask(): Promise<number> {
    const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * DAY_MS)
    const total = await this.deleteInBatches(
      () =>
        this.prisma.auditLog.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          take: BATCH_SIZE,
        }),
      (ids) => this.prisma.auditLog.deleteMany({ where: { id: { in: ids } } }),
    )
    this.logger.log(`cleanAuditLogs: удалено ${total}`)
    return total
  }

  // Объекты MinIO без записи в File. Ежедневно, 04:00.
  @Cron('0 4 * * *', { name: 'cleanOrphanFiles' })
  async cleanOrphanFiles(): Promise<number | null> {
    return this.locks.run('cleanOrphanFiles', LOCK_TTL_MS.cleanOrphanFiles, () =>
      this.cleanOrphanFilesTask(),
    )
  }

  private async cleanOrphanFilesTask(): Promise<number> {
    const buckets = [
      this.config.get('MINIO_BUCKET_AVATARS', { infer: true }),
      this.config.get('MINIO_BUCKET_POSTS', { infer: true }),
      this.config.get('MINIO_BUCKET_STORIES', { infer: true }),
      this.config.get('MINIO_BUCKET_APPLICATIONS', { infer: true }),
    ]
    const safetyBefore = new Date(Date.now() - ORPHAN_SAFETY_MINUTES * 60 * 1000)
    let removed = 0

    for (const bucket of buckets) {
      try {
        const objects = await this.listObjects(bucket)
        // Только объекты старше окна безопасности (не мешаем незавершённым загрузкам).
        const candidates = objects.filter((o) => o.lastModified < safetyBefore)
        for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
          const chunk = candidates.slice(i, i + BATCH_SIZE)
          const existing = await this.prisma.file.findMany({
            where: { bucket, key: { in: chunk.map((c) => c.name) } },
            select: { key: true },
            take: chunk.length,
          })
          const known = new Set(existing.map((e) => e.key))
          const orphans = chunk.filter((c) => !known.has(c.name))
          for (const orphan of orphans) {
            await this.minio.removeObject(bucket, orphan.name)
          }
          removed += orphans.length
        }
      } catch (err) {
        // MinIO недоступен/бакета нет — логируем и продолжаем (graceful degradation).
        this.logger.warn(`cleanOrphanFiles: бакет ${bucket} пропущен: ${(err as Error).message}`)
      }
    }
    this.logger.log(`cleanOrphanFiles: удалено осиротевших объектов ${removed}`)
    return removed
  }

  // Ежедневная сводка команде платформы. Ежечасно, а отправляет только в тот час,
  // который админ выбрал: хранить расписание в cron-выражении значило бы перезапускать
  // приложение ради смены времени.
  @Cron('5 * * * *', { name: 'sendDailyDigest' })
  async sendDailyDigest(): Promise<number | null> {
    return this.locks.run('sendDailyDigest', LOCK_TTL_MS.sendDailyDigest, () =>
      this.sendDailyDigestTask(),
    )
  }

  private async sendDailyDigestTask(): Promise<number> {
    const policy = await this.platform.notificationPolicy()
    if (policy.digestHour === null || policy.digestHour !== new Date().getHours()) return 0

    const [complaints, tickets] = await Promise.all([
      this.prisma.complaint.count({ where: { status: { in: ['PENDING', 'REVIEWING'] } } }),
      this.prisma.chat.count({ where: { type: 'SUPPORT_PLATFORM', supportClosedAt: null } }),
    ])

    // Сводку шлём, даже когда всё разобрано: «ноль и ноль» — это тоже новость, и по её
    // отсутствию нельзя отличить спокойный день от сломавшейся отправки.
    await this.telegram.notifyStaff(
      'digest',
      `Сводка за день: жалоб в очереди ${complaints}, открытых обращений ${tickets}`,
    )
    this.logger.log(`sendDailyDigest: жалоб ${complaints}, обращений ${tickets}`)
    return 1
  }

  // Очередь жалоб выросла сверх порога. Ежечасно, с паузой между сигналами.
  @Cron('15 * * * *', { name: 'alertQueueBacklog' })
  async alertQueueBacklog(): Promise<number | null> {
    return this.locks.run('alertQueueBacklog', LOCK_TTL_MS.alertQueueBacklog, () =>
      this.alertQueueBacklogTask(),
    )
  }

  private async alertQueueBacklogTask(): Promise<number> {
    const pending = await this.prisma.complaint.count({
      where: { status: { in: ['PENDING', 'REVIEWING'] } },
    })
    if (pending < QUEUE_BACKLOG_THRESHOLD) {
      // Очередь разгребли — снимаем паузу, чтобы следующий всплеск не пропустить.
      await this.redis.del(QUEUE_BACKLOG_KEY).catch(() => undefined)
      return 0
    }

    // SET NX: между инстансами побеждает один, и повторного сигнала не будет даже если
    // задача каким-то образом выполнится дважды.
    const first = await this.redis
      .set(QUEUE_BACKLOG_KEY, String(pending), 'EX', QUEUE_BACKLOG_SILENCE_SEC, 'NX')
      .catch(() => null)
    if (first === null) return 0

    await this.telegram.notifyStaff('complaint', `В очереди накопилось жалоб: ${pending}`)
    this.logger.log(`alertQueueBacklog: жалоб ${pending}`)
    return pending
  }

  // Обращения без движения. Ежедневно в 05:00, после уборки файлов.
  @Cron('0 5 * * *', { name: 'closeStaleTickets' })
  async closeStaleTickets(): Promise<number | null> {
    return this.locks.run('closeStaleTickets', LOCK_TTL_MS.closeStaleTickets, async () => {
      const closed = await this.support.closeStale(
        new Date(Date.now() - SUPPORT_STALE_DAYS * DAY_MS),
      )
      this.logger.log(`closeStaleTickets: закрыто ${closed}`)
      return closed
    })
  }

  /**
   * Живость зависимостей и всплеск ошибок. Каждые пять минут.
   *
   * Проверяются те же три зависимости, что и в `/health`, но своими клиентами: расписание
   * обязано жить здесь (§9.3), а тянуть сюда индикаторы terminus значило бы связать
   * уборку с модулем здоровья ради трёх строк.
   */
  @Cron('*/5 * * * *', { name: 'watchServices' })
  async watchServices(): Promise<number | null> {
    return this.locks.run('watchServices', LOCK_TTL_MS.watchServices, () => this.watchTask())
  }

  private async watchTask(): Promise<number> {
    const down: string[] = []
    await this.prisma.$queryRaw`SELECT 1`.catch(() => down.push('база данных'))
    await this.redis.ping().catch(() => down.push('Redis'))
    await this.minio
      .bucketExists(this.config.get('MINIO_BUCKET_AVATARS', { infer: true }))
      .catch(() => down.push('хранилище'))

    const wasDown = (await this.redis.get(SERVICES_STATE_KEY).catch(() => null)) !== null
    if (down.length > 0 && !wasDown) {
      await this.redis
        .set(SERVICES_STATE_KEY, down.join(','), 'EX', DAY_MS / 1000)
        .catch(() => undefined)
      await this.telegram.notifyStaff(
        'digest',
        `Не отвечает: ${down.join(', ')}`,
        undefined,
        new Date(),
        true,
      )
    } else if (down.length === 0 && wasDown) {
      await this.redis.del(SERVICES_STATE_KEY).catch(() => undefined)
      await this.telegram.notifyStaff(
        'digest',
        'Все сервисы снова отвечают',
        undefined,
        new Date(),
        true,
      )
    }

    // Всплеск серверных ошибок за последний час.
    const errors = await countServerErrors(this.redis, 60)
    if (errors >= ERROR_SPIKE_THRESHOLD) {
      const first = await this.redis
        .set(ERROR_SPIKE_KEY, String(errors), 'EX', ERROR_SPIKE_SILENCE_SEC, 'NX')
        .catch(() => null)
      if (first !== null) {
        await this.telegram.notifyStaff('digest', `Всплеск ошибок: ${errors} за час`)
      }
    }

    if (down.length > 0) this.logger.warn(`watchServices: не отвечают ${down.join(', ')}`)
    return down.length
  }

  // --- Отложенные задачи: модели появятся в следующих фазах, тогда навесим @Cron ---
  // deleteExpiredStories ('*/30 * * * *') — удаление истёкших Story из БД и MinIO. Модель Story — Ф14.

  /** Удаление батчами по BATCH_SIZE: находим id → deleteMany → повторяем, пока есть записи. */
  private async deleteInBatches(
    findBatch: () => Promise<{ id: string }[]>,
    deleteByIds: (ids: string[]) => Promise<{ count: number }>,
  ): Promise<number> {
    let total = 0
    for (;;) {
      const batch = await findBatch()
      if (batch.length === 0) break
      const { count } = await deleteByIds(batch.map((b) => b.id))
      total += count
      if (batch.length < BATCH_SIZE) break
    }
    return total
  }

  /** Собирает список объектов бакета (рекурсивно) из потока MinIO в массив. */
  private listObjects(bucket: string): Promise<{ name: string; lastModified: Date }[]> {
    return new Promise((resolve, reject) => {
      const out: { name: string; lastModified: Date }[] = []
      const stream = this.minio.listObjectsV2(bucket, '', true)
      stream.on('data', (obj) => {
        if (obj.name) out.push({ name: obj.name, lastModified: obj.lastModified ?? new Date(0) })
      })
      stream.on('end', () => resolve(out))
      stream.on('error', reject)
    })
  }
}
