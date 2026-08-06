import { Inject, Injectable } from '@nestjs/common'
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

// Публичная выборка уведомления: без userId и dedupeKey (внутренние поля).
const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  data: true,
  isRead: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect

// Дефолты настроек — совпадают с @default в схеме Prisma.
const DEFAULT_SETTINGS = {
  emailEnabled: true,
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

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Лента уведомлений пользователя (cursor-пагинация, свежие сверху). */
  async list(userId: string, query: NotificationListQueryInput): Promise<Paginated<unknown>> {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unreadOnly ? { isRead: false } : {}),
    }
    const rows = await this.prisma.notification.findMany({
      where,
      select: NOTIFICATION_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })
    const hasNext = rows.length > query.limit
    const items = hasNext ? rows.slice(0, query.limit) : rows
    const nextCursor = hasNext ? items[items.length - 1]?.id : undefined
    return new Paginated(items, { cursor: nextCursor, hasNext })
  }

  /** Число непрочитанных с Redis-кэшем. */
  async unreadCount(userId: string): Promise<{ count: number }> {
    const cached = await this.redis.get(unreadKey(userId))
    if (cached !== null) {
      return { count: Number(cached) }
    }
    const count = await this.prisma.notification.count({ where: { userId, isRead: false } })
    await this.redis.set(unreadKey(userId), String(count), 'EX', UNREAD_TTL_SECONDS)
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

  /** Сбросить кэш непрочитанных — вызывается при создании (процессор) и мутациях. */
  async invalidateUnread(userId: string): Promise<void> {
    await this.redis.del(unreadKey(userId))
  }
}
