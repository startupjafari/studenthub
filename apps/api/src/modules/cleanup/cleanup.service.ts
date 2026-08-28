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
  sweepDocumentExpiry: 15 * 60 * 1000,
  expireInvites: 10 * 60 * 1000,
  cleanOldNotifications: 30 * 60 * 1000,
  cleanAuditLogs: 30 * 60 * 1000,
  cleanOrphanFiles: 60 * 60 * 1000,
} as const
const NOTIFICATION_RETENTION_DAYS = 30
const AUDIT_RETENTION_DAYS = 90
// Не трогаем свежие объекты MinIO — они могут быть в процессе загрузки (запись File ещё не создана).
const ORPHAN_SAFETY_MINUTES = 60

const DAY_MS = 24 * 60 * 60 * 1000

// Итог ночной уборки сирот живёт двое суток: сводка читает его раз в день, и пропуск
// одного запуска не должен превращаться в пустую строку навсегда.
const ORPHAN_SWEEP_KEY = 'ops:cleanup:orphans'
const ORPHAN_SWEEP_TTL_SEC = 48 * 60 * 60

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
    private readonly locks: CronLockService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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
    await this.rememberOrphanSweep(removed)
    return removed
  }

  /**
   * Итог последней уборки сирот — его показывает суточная сводка служебного канала
   * (docs/TELEGRAM_BOT.md §2.3). В Redis, а не в памяти: задача идёт ночью на одной реплике,
   * а сводку в 21:00 читает, возможно, другая.
   */
  private async rememberOrphanSweep(removed: number): Promise<void> {
    try {
      await this.redis.set(ORPHAN_SWEEP_KEY, String(removed), 'EX', ORPHAN_SWEEP_TTL_SEC)
    } catch (error) {
      // Не смогли запомнить — сводка покажет «нет данных». Уборка при этом отработала.
      this.logger.warn(`cleanOrphanFiles: итог не сохранён: ${(error as Error).message}`)
    }
  }

  /** Сколько сирот нашла последняя ночная уборка. `null` — уборки ещё не было. */
  async lastOrphanSweep(): Promise<number | null> {
    try {
      const raw = await this.redis.get(ORPHAN_SWEEP_KEY)
      return raw === null ? null : Number(raw)
    } catch {
      return null
    }
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
