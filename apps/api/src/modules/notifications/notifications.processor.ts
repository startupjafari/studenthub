import { Logger } from '@nestjs/common'
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import type { Job } from 'bullmq'
import { NotificationType, type NotificationSettings, type Prisma } from '@prisma/client'
import { reportJobFailure } from '../../common/monitoring'
import { PrismaService } from '../../common/prisma/prisma.service'
import { RealtimeGateway } from '../../common/realtime'
import { EMAIL_JOBS, QUEUES, QueueService, type JobPayload } from '../../common/queue'
import { NotificationsService } from './notifications.service'
import { PushService } from '../push/push.service'
import type { NotificationJobData } from './notification-job.type'

// Сколько адресатов читаем за один запрос. Рассылка на факультет — это тысячи получателей
// в payload'е job'а, поэтому запросы по `id IN (...)` разбиваем на страницы: обрезать список
// потолком нельзя (часть людей молча не получит уведомление), а тянуть всех одним
// findMany — тот самый запрет из BACKEND_RULES §7.2.
const RECIPIENT_CHUNK = 500

/** Разбивка списка на страницы по RECIPIENT_CHUNK. */
function chunked<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += RECIPIENT_CHUNK) {
    out.push(items.slice(i, i + RECIPIENT_CHUNK))
  }
  return out
}

// Воркер очереди `notifications` (docs/PROJECT.md §10.1, задача Ф3.4).
// Для каждого получателя: создать Notification (идемпотентно по dedupeKey) →
// онлайн → WS `notification:new`; офлайн + включён email-канал → job в очередь `email`.
// Все документированные job-имена (new-message, schedule-changed, …) идут через единый
// обработчик: имя job'а — для наблюдаемости, семантику несёт поле `type` в payload.
@Processor(QUEUES.NOTIFICATIONS)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly queue: QueueService,
    private readonly notifications: NotificationsService,
    private readonly push: PushService,
  ) {
    super()
  }

  // Ф13.8: исчерпавший попытки job больше не пропадает молча — лог + Sentry.
  // `job.data` в трекер не уходит (в payload'ах — получатели и тексты, §11.3).
  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    reportJobFailure(this.logger, QUEUES.NOTIFICATIONS, job, error)
  }

  async process(job: Job<JobPayload>): Promise<void> {
    const { _meta, ...raw } = job.data
    const data = raw as unknown as NotificationJobData
    const requestId = _meta?.requestId

    if (!data.recipientIds?.length || !data.dedupeKey) {
      this.logger.warn(`notifications job ${job.name} без получателей/dedupeKey — пропуск`)
      return
    }

    // Активные адресаты + их настройки каналов.
    const users = []
    for (const ids of chunked(data.recipientIds)) {
      const page = await this.prisma.user.findMany({
        where: { id: { in: ids }, deletedAt: null, isBlocked: false },
        select: { id: true, email: true, firstName: true, notificationSettings: true },
        take: ids.length,
      })
      users.push(...page)
    }

    // Фильтр по пер-тип настройке (SYSTEM доставляется всегда).
    const allowed = users.filter((u) => this.typeEnabled(data.type, u.notificationSettings))
    if (!allowed.length) return

    const allowedIds = allowed.map((u) => u.id)

    // Идемпотентность: адресаты, у которых уведомление с этим dedupeKey уже есть, — пропускаются
    // целиком (ни повторной записи, ни повторных WS/email при перезапуске job'а).
    const existingIds = new Set<string>()
    for (const ids of chunked(allowedIds)) {
      const page = await this.prisma.notification.findMany({
        where: { userId: { in: ids }, dedupeKey: data.dedupeKey },
        select: { userId: true },
        take: ids.length,
      })
      for (const e of page) existingIds.add(e.userId)
    }
    const fresh = allowed.filter((u) => !existingIds.has(u.id))
    if (!fresh.length) {
      this.logger.debug(`notifications ${job.name} dedupeKey=${data.dedupeKey}: всё уже доставлено`)
      return
    }

    await this.prisma.notification.createMany({
      data: fresh.map((u) => ({
        userId: u.id,
        type: data.type,
        title: data.title,
        body: data.body,
        data: (data.data ?? undefined) as Prisma.InputJsonValue | undefined,
        dedupeKey: data.dedupeKey,
      })),
      skipDuplicates: true,
    })

    // Создали новые непрочитанные — сбрасываем кэш счётчика у каждого адресата.
    await Promise.all(fresh.map((u) => this.notifications.invalidateUnread(u.id)))

    const created = []
    for (const ids of chunked(fresh.map((u) => u.id))) {
      const page = await this.prisma.notification.findMany({
        where: { userId: { in: ids }, dedupeKey: data.dedupeKey },
        take: ids.length,
      })
      created.push(...page)
    }
    const byUser = new Map(created.map((n) => [n.userId, n]))

    const online = await this.realtime.getOnlineUserIds(fresh.map((u) => u.id))
    const wantEmail = data.emailFallback ?? true
    let delivered = 0
    let queuedEmail = 0
    let queuedPush = 0

    for (const u of fresh) {
      const notification = byUser.get(u.id)
      if (!notification) continue

      if (online.has(u.id)) {
        this.realtime.emitToUser(u.id, 'notification:new', { notification })
        // Параллельно — единый конверт (PR-8/#12); старое событие выше не трогаем.
        this.realtime.emitEventToUser(u.id, 'notification.created', notification.id, {
          notification,
        })
        delivered += 1
        continue
      }
      // Офлайн: доставляем по включённым каналам (push и/или email — независимые тумблеры).
      const url = (notification.data as { url?: string } | null)?.url
      if (this.pushEnabled(u.notificationSettings)) {
        await this.push.sendToUser(u.id, {
          title: notification.title,
          body: notification.body,
          url,
        })
        queuedPush += 1
      }
      if (wantEmail && this.emailEnabled(u.notificationSettings) && u.email) {
        await this.queue.enqueue(
          QUEUES.EMAIL,
          EMAIL_JOBS.SEND_NOTIFICATION,
          {
            to: u.email,
            firstName: u.firstName,
            notificationTitle: notification.title,
            notificationBody: notification.body,
          },
          // jobId на основе dedupeKey → офлайн-письмо не задваивается при перезапуске.
          { requestId, jobId: `notif-email:${data.dedupeKey}:${u.id}` },
        )
        queuedEmail += 1
      }
    }

    this.logger.log(
      `notifications ${job.name} type=${data.type}: создано ${fresh.length}, WS ${delivered}, push ${queuedPush}, email ${queuedEmail} (requestId=${requestId ?? '-'})`,
    )
  }

  private typeEnabled(type: NotificationType, settings: NotificationSettings | null): boolean {
    if (!settings) return true // нет строки настроек → дефолты (всё включено)
    switch (type) {
      case NotificationType.SCHEDULE_CHANGE:
        return settings.scheduleChangeEnabled
      case NotificationType.APP_UPDATE:
        return settings.appUpdateEnabled
      case NotificationType.MESSAGE:
        return settings.messageEnabled
      case NotificationType.POST:
        return settings.postEnabled
      case NotificationType.EVENT:
        return settings.eventEnabled
      case NotificationType.SYSTEM:
        return true // системные уведомления не отключаются
      default:
        return true
    }
  }

  private emailEnabled(settings: NotificationSettings | null): boolean {
    return settings ? settings.emailEnabled : true
  }

  // Push по умолчанию ВЫКЛ (нет строки настроек или pushEnabled=false) — включается тумблером.
  private pushEnabled(settings: NotificationSettings | null): boolean {
    return settings ? settings.pushEnabled : false
  }
}
