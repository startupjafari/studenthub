import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import webpush from 'web-push'
import { PrismaService } from '../../common/prisma/prisma.service'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
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
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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
          this.count('sent')
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode
          if (statusCode === 404 || statusCode === 410) {
            // Подписка мертва (устройство отписалось/сбросило) — чистим.
            this.count('gone')
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

  /**
   * Итоги рассылки за сутки — строка суточной сводки (docs/TELEGRAM_BOT.md §2.3).
   *
   * Доля `410 Gone` — это не ошибка отправки, а мусор в таблице: устройства отписались,
   * а записи остались. Растёт — пора чистить, и узнать об этом лучше по тренду, чем
   * по распухшей таблице.
   */
  async deliveryStats(): Promise<{ sent: number; gone: number; goneShare: number }> {
    try {
      const [sent, gone] = await this.redis.hmget(STATS_KEY, 'sent', 'gone')
      const sentCount = Number(sent ?? 0)
      const goneCount = Number(gone ?? 0)
      const total = sentCount + goneCount
      return {
        sent: sentCount,
        gone: goneCount,
        goneShare: total ? Math.round((goneCount / total) * 1000) / 10 : 0,
      }
    } catch (error) {
      this.logger.warn(`Не удалось прочитать статистику push: ${String(error)}`)
      return { sent: 0, gone: 0, goneShare: 0 }
    }
  }

  /**
   * Счётчик живёт в Redis, а не в памяти: отправка идёт из воркера уведомлений, а сводку
   * читает воркер служебного канала — возможно, в другой реплике. Сбой Redis теряет
   * счётчик, но не push: инкремент не ожидается и не бросает.
   */
  private count(kind: 'sent' | 'gone'): void {
    void this.redis
      .pipeline()
      .hincrby(STATS_KEY, kind, 1)
      .expire(STATS_KEY, STATS_TTL_SEC)
      .exec()
      .catch(() => undefined)
  }
}

// Скользящее суточное окно: ключ живёт 25 часов и продлевается при каждой отправке.
const STATS_KEY = 'ops:push:stats'
const STATS_TTL_SEC = 25 * 60 * 60
