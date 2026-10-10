import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import webpush from 'web-push'
import { PrismaService } from '../../common/prisma/prisma.service'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import type { EnvVars } from '../../config/env.schema'
import type { RegisterDeviceInput } from '@studenthub/shared-schemas'
import { ApnsService } from './apns.service'

export interface PushPayload {
  title: string
  body: string
  url?: string
}

interface SubscriptionInput {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

// Web Push (Ф13.3): подписки браузеров + отправка через VAPID. Без ключей — молча отключён.
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name)
  private enabled = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvVars, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly apns: ApnsService,
  ) {}

  onModuleInit(): void {
    const publicKey = this.config.get('VAPID_PUBLIC_KEY', { infer: true })
    const privateKey = this.config.get('VAPID_PRIVATE_KEY', { infer: true })
    const subject = this.config.get('VAPID_SUBJECT', { infer: true })
    if (publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey)
      this.enabled = true
      this.logger.log('Web Push включён (VAPID настроен)')
    } else {
      this.logger.warn('Web Push отключён: не заданы VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY')
    }
  }

  /** Публичный VAPID-ключ для клиентской подписки (null — push отключён). */
  get publicKey(): string | null {
    return this.config.get('VAPID_PUBLIC_KEY', { infer: true }) ?? null
  }

  /** Сохранить/обновить подписку (endpoint уникален; при смене пользователя перепривязываем). */
  async saveSubscription(
    userId: string,
    sub: SubscriptionInput,
    userAgent?: string,
  ): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: {
        userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent,
      },
      update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent },
    })
  }

  async removeSubscription(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } })
  }

  /**
   * Зарегистрировать устройство (план iOS, Задача Б1).
   *
   * Токен уникален сам по себе, поэтому `upsert` по нему, а не по паре с
   * пользователем: одно и то же устройство может сменить владельца — человек вышел
   * и вошёл под другим аккаунтом, — и пуши обязаны уйти за ним, а не остаться у
   * прежнего.
   */
  async registerDevice(userId: string, input: RegisterDeviceInput): Promise<void> {
    await this.prisma.deviceToken.upsert({
      where: { token: input.token },
      create: {
        userId,
        token: input.token,
        platform: input.platform,
        appVersion: input.appVersion,
      },
      update: { userId, appVersion: input.appVersion, lastSeenAt: new Date() },
    })
  }

  /** Отвязать устройство: выход из аккаунта на телефоне. */
  async unregisterDevice(userId: string, token: string): Promise<void> {
    await this.prisma.deviceToken.deleteMany({ where: { userId, token } })
  }

  /**
   * Отправить push на все устройства пользователя: браузеры и телефоны.
   *
   * Два транспорта рядом, потому что у человека обычно и то, и другое: веб на
   * работе, телефон в кармане. Отказ одного не отменяет другой.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    await Promise.all([this.sendWebPush(userId, payload), this.sendToDevices(userId, payload)])
  }

  /**
   * Пуши на телефоны. Бейдж — число непрочитанных уведомлений: считаем один раз на
   * отправку по индексу `[userId, isRead]`, иначе цифра на иконке живёт своей
   * жизнью и перестаёт что-либо значить.
   */
  private async sendToDevices(userId: string, payload: PushPayload): Promise<void> {
    if (!this.apns.isEnabled()) return
    const devices = await this.prisma.deviceToken.findMany({ where: { userId }, take: 20 })
    if (devices.length === 0) return

    const badge = await this.prisma.notification.count({ where: { userId, isRead: false } })
    await Promise.all(
      devices.map(async (device) => {
        const outcome = await this.apns.send(device.token, {
          title: payload.title,
          body: payload.body,
          url: payload.url,
          badge,
        })
        if (outcome === 'gone') {
          // Приложение удалили или переустановили — адреса больше нет.
          await this.prisma.deviceToken.deleteMany({ where: { token: device.token } })
        }
      }),
    )
  }

  private async sendWebPush(userId: string, payload: PushPayload): Promise<void> {
    if (!this.enabled) return
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId }, take: 20 })
    if (subs.length === 0) return
    const body = JSON.stringify(payload)
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
          )
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode
          if (statusCode === 404 || statusCode === 410) {
            // Подписка мертва (устройство отписалось/сбросило) — чистим.
            await this.prisma.pushSubscription
              .deleteMany({ where: { endpoint: s.endpoint } })
              .catch(() => undefined)
          } else {
            this.logger.warn(`Не удалось отправить push (${statusCode ?? '?'}): ${String(err)}`)
          }
        }
      }),
    )
  }
}
