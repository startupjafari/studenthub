import { Inject, Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type Redis from 'ioredis'
import type {
  NotificationListQueryInput,
  UpdateNotificationSettingsInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { REDIS_CLIENT } from '../../common/redis/redis.module'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import { NEWEST_FIRST, encodeKeyset, keysetFrom, olderThan } from '../../common/http/keyset-cursor'

// Публичная выборка уведомления: без userId и dedupeKey (внутренние поля).
//
// `titleKey`/`bodyKey`/`params` отдаём наружу намеренно: человек меняет язык в настройках
// и ожидает увидеть на новом языке и вчерашние уведомления. Без ключа клиенту нечем их
// перерисовать — осталась бы двуязычная лента. Текст `title`/`body` при этом остаётся:
// у части уведомлений словарной статьи нет (имя отправителя, превью сообщения).
const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  titleKey: true,
  bodyKey: true,
  params: true,
  data: true,
  isRead: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect

// Дефолты настроек — совпадают с @default в схеме Prisma.
const DEFAULT_SETTINGS = {
  emailEnabled: true,
  // Выключен до согласия: в вебе — тумблер с разрешением браузера, на телефоне —
  // первая регистрация устройства (PushService.registerDevice включает флаг сама).
  pushEnabled: false,
  scheduleChangeEnabled: true,
  appUpdateEnabled: true,
  messageEnabled: true,
  postEnabled: true,
  eventEnabled: true,
  systemEnabled: true,
}

const SETTINGS_SELECT = {
  emailEnabled: true,
  pushEnabled: true,
  scheduleChangeEnabled: true,
  appUpdateEnabled: true,
  messageEnabled: true,
  postEnabled: true,
  eventEnabled: true,
  systemEnabled: true,
} satisfies Prisma.NotificationSettingsSelect

// Кэш счётчика непрочитанных живёт до явной инвалидации; TTL — страховочный бэкстоп.
const UNREAD_TTL_SECONDS = 300
const unreadKey = (userId: string): string => `notif:unread:${userId}`

// Письмо-зеркало свёрнутого уведомления (сообщения чата) — не чаще раза в 6 часов на ключ.
// Само сворачивание шлёт письмо, только когда строка заново стала непрочитанной; окно —
// потолок сверху для того, кто то и дело заглядывает в колокольчик и снова уходит.
const COLLAPSED_EMAIL_WINDOW_SECONDS = 6 * 60 * 60
const emailSlotKey = (userId: string, key: string): string => `notif:email:${userId}:${key}`

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Лента уведомлений пользователя (cursor-пагинация, свежие сверху).
   *
   * Курсор несёт момент и id последней строки (keyset-cursor.ts), а не голый id для
   * Prisma-курсора: свёрнутая строка чата при новом сообщении «подпрыгивает» наверх (новый
   * createdAt), и курсор по её id отдавал страницу заново — дубли; удалённая курсорная строка
   * обрывала листание пустой страницей. Голый id от прежних клиентов ещё понимаем.
   */
  async list(userId: string, query: NotificationListQueryInput): Promise<Paginated<unknown>> {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unreadOnly ? { isRead: false } : {}),
    }
    const after = query.cursor
      ? await keysetFrom(query.cursor, (id) =>
          this.prisma.notification.findFirst({
            where: { id, userId },
            select: { createdAt: true, id: true },
          }),
        )
      : null
    if (query.cursor && !after) return new Paginated([], { hasNext: false })
    const rows = await this.prisma.notification.findMany({
      where: after ? { AND: [where, olderThan(after)] } : where,
      select: NOTIFICATION_SELECT,
      orderBy: NEWEST_FIRST,
      take: query.limit + 1,
    })
    const hasNext = rows.length > query.limit
    const items = hasNext ? rows.slice(0, query.limit) : rows
    const last = items.at(-1)
    return new Paginated(items, {
      cursor: hasNext && last ? encodeKeyset(last) : undefined,
      hasNext,
    })
  }

  /**
   * Число непрочитанных с Redis-кэшем. Кэш — best-effort: при недоступном Redis не роняем
   * и не подвешиваем постоянно опрашиваемый эндпоинт колокольчика, а считаем по БД.
   */
  async unreadCount(userId: string): Promise<{ count: number }> {
    try {
      const cached = await this.redis.get(unreadKey(userId))
      if (cached !== null) {
        return { count: Number(cached) }
      }
    } catch (error) {
      this.logger.warn({ err: error, userId }, 'Redis недоступен — unreadCount по БД')
    }
    const count = await this.prisma.notification.count({ where: { userId, isRead: false } })
    try {
      await this.redis.set(unreadKey(userId), String(count), 'EX', UNREAD_TTL_SECONDS)
    } catch {
      /* кэш best-effort: промах записи не критичен */
    }
    return { count }
  }

  /** Пометить одно уведомление прочитанным (только своё). */
  async markRead(userId: string, id: string): Promise<unknown> {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    })
    // count 0 — либо уже прочитано, либо не своё/не найдено. Отличаем NOT_FOUND от «уже прочитано».
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
      select: NOTIFICATION_SELECT,
    })
    if (!notification) {
      throw new AppException('NOT_FOUND', 'Уведомление не найдено')
    }
    if (count > 0) {
      await this.invalidateUnread(userId)
    }
    return notification
  }

  /** Пометить все прочитанными. */
  async markAllRead(userId: string): Promise<{ updated: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    })
    if (count > 0) {
      await this.invalidateUnread(userId)
    }
    return { updated: count }
  }

  /** Удалить уведомление (только своё). */
  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.notification.deleteMany({ where: { id, userId } })
    if (count === 0) {
      throw new AppException('NOT_FOUND', 'Уведомление не найдено')
    }
    await this.invalidateUnread(userId)
  }

  /** Настройки уведомлений; при отсутствии строки — создаём дефолтную. */
  async getSettings(userId: string): Promise<unknown> {
    const existing = await this.prisma.notificationSettings.findUnique({
      where: { userId },
      select: SETTINGS_SELECT,
    })
    if (existing) return existing
    return this.prisma.notificationSettings.create({
      data: { userId, ...DEFAULT_SETTINGS },
      select: SETTINGS_SELECT,
    })
  }

  /** Обновить настройки (upsert: недостающая строка создаётся с дефолтами + патч). */
  async updateSettings(userId: string, patch: UpdateNotificationSettingsInput): Promise<unknown> {
    return this.prisma.notificationSettings.upsert({
      where: { userId },
      update: patch,
      create: { userId, ...DEFAULT_SETTINGS, ...patch },
      select: SETTINGS_SELECT,
    })
  }

  /**
   * Сбросить кэш непрочитанных — вызывается при создании (процессор) и мутациях.
   * best-effort: при недоступном Redis не роняем мутацию (кэш протухнет по TTL).
   */
  async invalidateUnread(userId: string): Promise<void> {
    try {
      await this.redis.del(unreadKey(userId))
    } catch (error) {
      this.logger.warn({ err: error, userId }, 'Redis недоступен — пропуск инвалидации кэша')
    }
  }

  /**
   * Занять окно письма о свёрнутом уведомлении: true — письмо слать можно, следующее по
   * этому ключу пройдёт не раньше чем через COLLAPSED_EMAIL_WINDOW_SECONDS.
   *
   * Недоступный Redis — false: письмо о сообщении не транзакционное, и пропустить его
   * лучше, чем слать без ограничителя. Очередь писем живёт в том же Redis, так что
   * поставить письмо в этот момент всё равно не вышло бы.
   */
  async claimEmailSlot(userId: string, key: string): Promise<boolean> {
    try {
      const claimed = await this.redis.set(
        emailSlotKey(userId, key),
        '1',
        'EX',
        COLLAPSED_EMAIL_WINDOW_SECONDS,
        'NX',
      )
      return claimed === 'OK'
    } catch (error) {
      this.logger.warn({ err: error, userId }, 'Redis недоступен — письмо-зеркало пропущено')
      return false
    }
  }
}
