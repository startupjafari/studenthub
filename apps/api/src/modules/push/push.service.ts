import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import webpush from 'web-push'
import { PrismaService } from '../../common/prisma/prisma.service'
import type { EnvVars } from '../../config/env.schema'

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

  /** Отправить push на все устройства пользователя. Просроченные подписки (404/410) удаляем. */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
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
