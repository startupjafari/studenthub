import { Logger } from '@nestjs/common'
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import type { Job } from 'bullmq'
import {
  NotificationType,
  Prisma,
  type Notification,
  type NotificationSettings,
} from '@prisma/client'
import { renderNotificationMessage } from '@studenthub/shared-config'
import { reportJobFailure } from '../../common/monitoring'
import { PrismaService } from '../../common/prisma/prisma.service'
import { RealtimeGateway } from '../../common/realtime'
import {
  EMAIL_JOBS,
  NOTIFICATION_JOBS,
  QUEUES,
  QueueService,
  type JobPayload,
} from '../../common/queue'
import { NotificationsService } from './notifications.service'
import { PushService, type PushChannels, type PushPayload } from '../push/push.service'
import type { NotificationJobData } from './notification-job.type'

// Сколько адресатов читаем за один запрос. Рассылка на факультет — это тысячи получателей
// в payload'е job'а, поэтому запросы по `id IN (...)` разбиваем на страницы: обрезать список
// потолком нельзя (часть людей молча не получит уведомление), а тянуть всех одним
// findMany — тот самый запрет из BACKEND_RULES §7.2.
const RECIPIENT_CHUNK = 500

// Сколько job'ов воркер ведёт одновременно. С одним обработчиком любая медленная рассылка
// (большая аудитория, тормозящий push-провайдер) держала всю очередь: ни колокольчика,
// ни WS, ни писем остальным, пока она не закончится.
const NOTIFICATIONS_CONCURRENCY = 5

// Сколько push-отправок идёт параллельно внутри job'а. Обход по одному превращал рассылку
// на тысячу офлайн-участников в тысячу ожиданий подряд, все разом — в тысячи одновременных
// запросов к провайдеру. Каждая отправка ограничена таймаутом транспорта (PushService).
const PUSH_PARALLEL = 20

// Приоритет писем-зеркал в очереди `email`. Job'ы без приоритета BullMQ берёт раньше
// приоритетных, поэтому инвайт, сброс пароля и подтверждение адреса (их ставят без
// приоритета) не ждут за хвостом рассылки.
const MIRROR_EMAIL_PRIORITY = 10

/**
 * Системные события, которые выключает тумблер «Системные» (`systemEnabled`, F-F25):
 * социальные — заявка в друзья, принятая дружба, запрос на переписку. Раньше тумблер
 * хранился и отдавался, но не читался вовсе.
 *
 * Остальные SYSTEM — решения и сроки, которые человек пропустить не должен: результат
 * проверки документа, задание и оценка, предупреждение модерации, приём и консультация,
 * итог жалобы, сбой отложенного сообщения. Они приходят всегда, как и раньше.
 */
const OPTIONAL_SYSTEM_JOBS: ReadonlySet<string> = new Set([
  NOTIFICATION_JOBS.FRIEND_REQUEST,
  NOTIFICATION_JOBS.FRIEND_ACCEPTED,
  NOTIFICATION_JOBS.CHAT_REQUEST,
])

/** Разбивка списка на страницы по RECIPIENT_CHUNK. */
function chunked<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += RECIPIENT_CHUNK) {
    out.push(items.slice(i, i + RECIPIENT_CHUNK))
  }
  return out
}

/**
 * Несёт ли свёрнутая строка уже это событие (повтор job'а). Продюсер кладёт в `data`
 * идентификатор события, поэтому совпадение всех полей `data` job'а и есть повтор.
 * Сравниваем по полям, а не JSON целиком: jsonb в Postgres переставляет ключи. Пустой
 * `data` повтором не считается — доставить дважды лучше, чем потерять событие.
 */
function sameEvent(
  stored: Prisma.JsonValue | null,
  incoming: Record<string, unknown> | null | undefined,
): boolean {
  if (!incoming || !stored || typeof stored !== 'object' || Array.isArray(stored)) return false
  const entries = Object.entries(incoming)
  return entries.length > 0 && entries.every(([key, value]) => stored[key] === value)
}

// Поля уведомления, общие для новой строки и поднятой свёрнутой.
type NotificationContent = Pick<
  Prisma.NotificationCreateManyInput,
  'type' | 'title' | 'body' | 'titleKey' | 'bodyKey' | 'params' | 'data'
>

interface Recipient {
  id: string
  email: string
  firstName: string
  locale: string
  notificationSettings: NotificationSettings | null
}

// Что доставить адресату. `becameUnread` — строка только что стала непрочитанной (новая
// или поднятая из прочитанной), а не обновлена поверх уже непрочитанной.
interface Delivery {
  user: Recipient
  notification: Notification
  becameUnread: boolean
}

// Воркер очереди `notifications` (docs/PROJECT.md §10.1, задача Ф3.4).
// Для каждого получателя: создать Notification (идемпотентно по dedupeKey; со свёрнутым
// collapseKey — поднять уже существующую) → онлайн → WS `notification:new`; офлайн →
// браузерный push и/или job в очередь `email` по включённым каналам. Push на телефоны —
// независимо от открытой вкладки.
// Все документированные job-имена (new-message, schedule-changed, …) идут через единый
// обработчик: имя job'а — для наблюдаемости и для того, какие SYSTEM можно выключить
// (OPTIONAL_SYSTEM_JOBS); остальную семантику несёт поле `type` в payload.
@Processor(QUEUES.NOTIFICATIONS, { concurrency: NOTIFICATIONS_CONCURRENCY })
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
    const users: Recipient[] = []
    for (const ids of chunked(data.recipientIds)) {
      const page = await this.prisma.user.findMany({
        where: { id: { in: ids }, deletedAt: null, isBlocked: false },
        select: {
          id: true,
          email: true,
          firstName: true,
          locale: true,
          notificationSettings: true,
        },
        take: ids.length,
      })
      users.push(...page)
    }

    // Фильтр по пер-тип настройке (важные SYSTEM доставляются всегда).
    const allowed = users.filter((u) =>
      this.typeEnabled(data.type, job.name, u.notificationSettings),
    )
    if (!allowed.length) return

    const deliveries = data.collapseKey
      ? await this.storeCollapsed(data, data.collapseKey, allowed)
      : await this.storeEach(data, allowed)
    if (!deliveries.length) {
      this.logger.debug(`notifications ${job.name} dedupeKey=${data.dedupeKey}: всё уже доставлено`)
      return
    }

    // Записали или подняли непрочитанные — сбрасываем кэш счётчика у каждого адресата.
    await Promise.all(deliveries.map((d) => this.notifications.invalidateUnread(d.user.id)))

    const online = await this.realtime.getOnlineUserIds(deliveries.map((d) => d.user.id))
    const wantEmail = data.emailFallback ?? true
    const pushes: { userId: string; payload: PushPayload; channels: PushChannels }[] = []
    let delivered = 0
    let queuedEmail = 0

    for (const { user: u, notification, becameUnread } of deliveries) {
      const isOnline = online.has(u.id)
      if (isOnline) {
        this.realtime.emitToUser(u.id, 'notification:new', { notification })
        // Параллельно — единый конверт (PR-8/#12); старое событие выше не трогаем.
        this.realtime.emitEventToUser(u.id, 'notification.created', notification.id, {
          notification,
        })
        delivered += 1
      }
      // Push — по устройствам, а не по «онлайн где угодно» (F-F25). Открытый сокет значит
      // лишь, что где-то открыта вкладка: забытая на рабочем компьютере, она гасила пуши
      // на телефон. Теперь телефону push уходит всегда, браузерам — только офлайн-адресату:
      // с открытой вкладкой уведомление и так пришло на страницу.
      if (this.pushEnabled(u.notificationSettings)) {
        const url = (notification.data as { url?: string } | null)?.url
        pushes.push({
          userId: u.id,
          payload: {
            title: notification.title,
            body: notification.body,
            url,
            // Свёрнутые (сообщения одного чата) — одной группой в шторке, а не десятком.
            ...(data.collapseKey ? { tag: data.collapseKey } : {}),
          },
          channels: { web: !isOnline, devices: true },
        })
      }
      if (isOnline) continue
      // Офлайн: письмо по своему тумблеру (push выше — независимый канал).
      if (
        wantEmail &&
        this.emailEnabled(u.notificationSettings) &&
        u.email &&
        (await this.mayMirrorByEmail(data, u.id, becameUnread))
      ) {
        await this.queue.enqueue(
          QUEUES.EMAIL,
          EMAIL_JOBS.SEND_NOTIFICATION,
          {
            to: u.email,
            firstName: u.firstName,
            locale: u.locale,
            notificationTitle: notification.title,
            notificationBody: notification.body,
          },
          // jobId на основе dedupeKey → офлайн-письмо не задваивается при перезапуске.
          {
            requestId,
            jobId: `notif-email:${data.dedupeKey}:${u.id}`,
            priority: MIRROR_EMAIL_PRIORITY,
          },
        )
        queuedEmail += 1
      }
    }

    await this.sendPushes(pushes)

    this.logger.log(
      `notifications ${job.name} type=${data.type}: доставка ${deliveries.length}, WS ${delivered}, push ${pushes.length}, email ${queuedEmail} (requestId=${requestId ?? '-'})`,
    )
  }

  /**
   * Строка на событие. Идемпотентность: адресаты, у которых уведомление с этим dedupeKey уже
   * есть, пропускаются целиком (ни повторной записи, ни повторных WS/email при перезапуске).
   */
  private async storeEach(data: NotificationJobData, allowed: Recipient[]): Promise<Delivery[]> {
    const existingIds = new Set<string>()
    for (const ids of chunked(allowed.map((u) => u.id))) {
      const page = await this.prisma.notification.findMany({
        where: { userId: { in: ids }, dedupeKey: data.dedupeKey },
        select: { userId: true },
        take: ids.length,
      })
      for (const e of page) existingIds.add(e.userId)
    }
    const fresh = allowed.filter((u) => !existingIds.has(u.id))
    if (!fresh.length) return []

    await this.prisma.notification.createMany({
      data: fresh.map((u) => ({
        userId: u.id,
        ...this.content(data, u.locale),
        dedupeKey: data.dedupeKey,
      })),
      skipDuplicates: true,
    })
    return this.collect(fresh, data.dedupeKey, () => true)
  }

  /**
   * Одна строка на `collapseKey` у получателя (F-F07). Нет строки — создаём; есть —
   * поднимаем: свежий текст, «сейчас» (лента колокольчика сортируется по createdAt),
   * снова непрочитано. Строка, уже несущая это событие, — повтор job'а: адресат
   * пропускается целиком, как при обычном dedupeKey.
   */
  private async storeCollapsed(
    data: NotificationJobData,
    key: string,
    allowed: Recipient[],
  ): Promise<Delivery[]> {
    const existing = new Map<string, { isRead: boolean; data: Prisma.JsonValue }>()
    for (const ids of chunked(allowed.map((u) => u.id))) {
      const page = await this.prisma.notification.findMany({
        where: { userId: { in: ids }, dedupeKey: key },
        select: { userId: true, isRead: true, data: true },
        take: ids.length,
      })
      for (const row of page) existing.set(row.userId, row)
    }
    const targets = allowed.filter((u) => {
      const row = existing.get(u.id)
      return !row || !sameEvent(row.data, data.data)
    })
    if (!targets.length) return []

    const fresh = targets.filter((u) => !existing.has(u.id))
    if (fresh.length) {
      await this.prisma.notification.createMany({
        data: fresh.map((u) => ({ userId: u.id, ...this.content(data, u.locale), dedupeKey: key })),
        skipDuplicates: true,
      })
    }

    // Текст зависит только от языка получателя — поднимаем пачкой на язык, а не строкой
    // на человека: в чате факультета это тысячи адресатов на каждое сообщение.
    const byLocale = new Map<string, string[]>()
    for (const u of targets) {
      if (!existing.has(u.id)) continue
      const group = byLocale.get(u.locale)
      if (group) group.push(u.id)
      else byLocale.set(u.locale, [u.id])
    }
    const now = new Date()
    for (const [locale, userIds] of byLocale) {
      for (const ids of chunked(userIds)) {
        await this.prisma.notification.updateMany({
          where: { userId: { in: ids }, dedupeKey: key },
          data: { ...this.content(data, locale), isRead: false, readAt: null, createdAt: now },
        })
      }
    }

    return this.collect(targets, key, (userId) => existing.get(userId)?.isRead ?? true)
  }

  /** Перечитать записанные строки (их id и поля уходят в WS) и сопоставить адресатам. */
  private async collect(
    recipients: Recipient[],
    dedupeKey: string,
    becameUnread: (userId: string) => boolean,
  ): Promise<Delivery[]> {
    const rows: Notification[] = []
    for (const ids of chunked(recipients.map((u) => u.id))) {
      const page = await this.prisma.notification.findMany({
        where: { userId: { in: ids }, dedupeKey },
        take: ids.length,
      })
      rows.push(...page)
    }
    const byUser = new Map(rows.map((n) => [n.userId, n]))
    const out: Delivery[] = []
    for (const user of recipients) {
      const notification = byUser.get(user.id)
      if (notification) out.push({ user, notification, becameUnread: becameUnread(user.id) })
    }
    return out
  }

  // Текст собираем на языке ИМЕННО ЭТОГО получателя: один job — много адресатов, и язык у
  // каждого свой. Рядом кладём ключ и параметры, чтобы ту же строку можно было собрать
  // заново, когда человек сменит язык в настройках.
  private content(data: NotificationJobData, locale: string): NotificationContent {
    return {
      type: data.type,
      title: this.render(data.titleKey, data.title, data.params, locale),
      body: this.render(data.bodyKey, data.body, data.params, locale),
      titleKey: data.titleKey ?? null,
      bodyKey: data.bodyKey ?? null,
      // DbNull, а не undefined: у поднятой свёрнутой строки не должны остаться параметры
      // и ссылка предыдущего события.
      params: data.params ? (data.params as Prisma.InputJsonValue) : Prisma.DbNull,
      data: data.data ? (data.data as Prisma.InputJsonValue) : Prisma.DbNull,
    }
  }

  /**
   * Письмо-зеркало. Обычное уведомление — всегда (канал включён, адресат офлайн). Свёрнутое
   * (сообщения чата, F-F08) — только когда строка заново стала непрочитанной и окно письма по
   * ключу свободно: иначе каждое сообщение каждому офлайн-участнику уходило письмом.
   */
  private async mayMirrorByEmail(
    data: NotificationJobData,
    userId: string,
    becameUnread: boolean,
  ): Promise<boolean> {
    if (!data.collapseKey) return true
    if (!becameUnread) return false
    return this.notifications.claimEmailSlot(userId, data.collapseKey)
  }

  /**
   * Push пачками по PUSH_PARALLEL. Сбой отправки одному адресату не роняет job: записи уже
   * сделаны, и перезапуск пропустил бы всех как доставленных — остальные просто не получили
   * бы push.
   */
  private async sendPushes(
    items: { userId: string; payload: PushPayload; channels: PushChannels }[],
  ): Promise<void> {
    for (let i = 0; i < items.length; i += PUSH_PARALLEL) {
      await Promise.all(
        items.slice(i, i + PUSH_PARALLEL).map(({ userId, payload, channels }) =>
          this.push.sendToUser(userId, payload, channels).catch((error: unknown) => {
            this.logger.warn({ err: error, userId }, 'push не отправлен')
          }),
        ),
      )
    }
  }

  /**
   * Строка уведомления для конкретного получателя.
   *
   * Порядок: словарная статья по ключу → готовый текст из job'а → пустая строка.
   *
   * Готовый текст нужен в двух случаях, и оба настоящие. Первый — строки, которым словарной
   * статьи не бывает: имя отправителя, превью сообщения, комментарий сотрудника. Второй —
   * выкатка: job'ы, положенные в очередь предыдущей версией кода, приходят без ключей, и
   * доставить их всё равно надо.
   */
  private render(
    key: string | undefined,
    fallback: string | undefined,
    params: Record<string, string | number> | undefined,
    locale: string,
  ): string {
    const fromDictionary = key ? renderNotificationMessage(locale, key, params) : null
    return fromDictionary ?? fallback ?? ''
  }

  private typeEnabled(
    type: NotificationType,
    jobName: string,
    settings: NotificationSettings | null,
  ): boolean {
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
        // Важные системные не отключаются; социальные — по тумблеру «Системные».
        return OPTIONAL_SYSTEM_JOBS.has(jobName) ? settings.systemEnabled : true
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
