import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'
import { InviteStatus } from '@prisma/client'
import type { Client as MinioClient } from 'minio'
import { PrismaService } from '../../common/prisma/prisma.service'
import { MINIO_CLIENT } from '../../common/minio/minio.constants'
import type { EnvVars } from '../../config/env.schema'
import { EventsService } from '../events/events.service'
import { PostsService } from '../posts/posts.service'
import { DocumentsService } from '../documents/documents.service'

// Единственный дом для cron-задач (docs/PROJECT.md §10.2, docs/BACKEND_RULES.md §9.3).
// Разбрасывать @Cron по модулям запрещено. Все задачи работают батчами и логируют счётчик.
// TODO(Ф13.9): в multi-instance деплое оборачивать в Redis-лок, чтобы задача шла на одном инстансе.
const BATCH_SIZE = 500
const NOTIFICATION_RETENTION_DAYS = 30
const AUDIT_RETENTION_DAYS = 90
// Не трогаем свежие объекты MinIO — они могут быть в процессе загрузки (запись File ещё не создана).
const ORPHAN_SAFETY_MINUTES = 60

const DAY_MS = 24 * 60 * 60 * 1000

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
  ) {}

  // Напоминания за час до события (docs/BACKEND_RULES.md §9.3): каждые 15 мин, окно [now+55, now+70],
  // дедуп через Event.reminderSentAt. Логика — в EventsService.remindDue (владелец домена).
  @Cron('*/15 * * * *', { name: 'scheduleEventReminders' })
  async scheduleEventReminders(): Promise<number> {
    return this.events.remindDue()
  }

  // Отложенная публикация постов: каждую минуту публикуем посты, у которых наступил scheduledAt.
  @Cron('* * * * *', { name: 'publishScheduledPosts' })
  async publishScheduledPosts(): Promise<number> {
    return this.posts.publishDueScheduled()
  }

  // Документы по сроку `expiresAt` → EXPIRING/EXPIRED + уведомления владельцам (§15.19).
  // Ежедневно в 03:30. Логика — в DocumentsService.sweepExpiry (владелец домена).
  @Cron('30 3 * * *', { name: 'sweepDocumentExpiry' })
  async sweepDocumentExpiry(): Promise<{ expired: number; expiring: number }> {
    return this.documents.sweepExpiry()
  }

  // Просроченные PENDING-инвайты → EXPIRED. Ежечасно.
  @Cron('0 * * * *', { name: 'expireInvites' })
  async expireInvites(): Promise<number> {
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
  async cleanOldNotifications(): Promise<number> {
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
  async cleanAuditLogs(): Promise<number> {
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
  async cleanOrphanFiles(): Promise<number> {
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
