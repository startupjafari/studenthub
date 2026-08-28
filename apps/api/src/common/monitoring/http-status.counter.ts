import { Inject, Injectable, Logger } from '@nestjs/common'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '../redis/redis.constants'

// Счётчик ответов по статусам (docs/TELEGRAM_BOT.md §2.3, §2.4).
//
// Отвечает на два вопроса служебного канала: «нет ли перебора паролей» (всплеск 401/403/429)
// и «какова доля 5xx» в суточной сводке. Оба нужны в агрегате по окну, поэтому счётчик один:
// два похожих, пишущих минутные корзины бок о бок, разошлись бы в числах — ровно та
// дублирующая ответственность, против которой §7.1.
//
// Живёт в `common`, потому что видят все ответы только глобальные фильтр и интерцептор,
// а они здесь. Модуль наблюдения счётчик читает и ничего в него не пишет.
//
// Что НЕ хранится: логины, email, идентификаторы пользователей, пути запросов. Только
// счётчики по статусу и число различных IP — через HyperLogLog, который держит хэши,
// а не сами адреса (§2.4 разрешает IP в контексте безопасности, но хранить их незачем).

const PREFIX = 'ops:http:'
const BUCKET_MS = 60_000

/** Корзины переживают самое широкое окно чтения (суточная сводка) с запасом. */
const BUCKET_TTL_SEC = 26 * 60 * 60

const AUTH_FAILURE_STATUSES = new Set([401, 403, 429])

export interface AuthFailureWindow {
  total: number
  /** Отдельно 429: сработал throttler — это уже не «ошибся паролем». */
  throttled: number
  distinctIps: number
  windowMinutes: number
}

export interface ErrorRateWindow {
  total: number
  serverErrors: number
  /** Доля 5xx в процентах, округлённая до десятых. */
  share: number
}

@Injectable()
export class HttpStatusCounter {
  private readonly logger = new Logger(HttpStatusCounter.name)

  // Копим в памяти и сбрасываем раз в минуту, а не пишем в Redis на каждый ответ:
  // при нескольких сотнях RPS это была бы лишняя команда на запрос ради чисел, которые
  // читают раз в пять минут. Сброс происходит на первом ответе новой минуты — таймер
  // здесь заводить нельзя, он работал бы и с выключенным служебным каналом.
  private bucket = currentBucket()
  private counts = new Map<number, number>()
  private ips = new Set<string>()

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Учитывает ответ. Вызывается на пути ответа пользователю, поэтому НИЧЕГО не ждёт
   * и никогда не бросает: наблюдение не имеет права задерживать ответ или превращать
   * 401 в 500.
   */
  record(status: number, ip?: string): void {
    const now = currentBucket()
    if (now !== this.bucket) {
      this.flush(this.bucket, this.counts, this.ips)
      this.bucket = now
      this.counts = new Map()
      this.ips = new Set()
    }
    this.counts.set(status, (this.counts.get(status) ?? 0) + 1)
    if (ip && AUTH_FAILURE_STATUSES.has(status)) {
      this.ips.add(ip)
    }
  }

  /** Всплеск неудачных авторизаций за окно (§2.4). */
  async authFailures(windowMinutes: number): Promise<AuthFailureWindow> {
    const empty: AuthFailureWindow = { total: 0, throttled: 0, distinctIps: 0, windowMinutes }
    try {
      const buckets = bucketKeys(windowMinutes)
      const byStatus = await this.readBuckets(buckets)
      const distinctIps = await this.redis.pfcount(...buckets.map((key) => `${key}:ips`))

      let total = 0
      for (const [status, count] of byStatus) {
        if (AUTH_FAILURE_STATUSES.has(status)) total += count
      }
      return { total, throttled: byStatus.get(429) ?? 0, distinctIps, windowMinutes }
    } catch (error) {
      this.logger.warn(`Не удалось прочитать счётчик отказов: ${String(error)}`)
      return empty
    }
  }

  /** Доля 5xx за окно — строка суточной сводки (§2.3). */
  async errorRate(windowMinutes: number): Promise<ErrorRateWindow> {
    try {
      const byStatus = await this.readBuckets(bucketKeys(windowMinutes))
      let total = 0
      let serverErrors = 0
      for (const [status, count] of byStatus) {
        total += count
        if (status >= 500) serverErrors += count
      }
      const share = total ? Math.round((serverErrors / total) * 1000) / 10 : 0
      return { total, serverErrors, share }
    } catch (error) {
      this.logger.warn(`Не удалось прочитать долю 5xx: ${String(error)}`)
      return { total: 0, serverErrors: 0, share: 0 }
    }
  }

  private async readBuckets(keys: string[]): Promise<Map<number, number>> {
    const results = await this.redis.pipeline(keys.map((key) => ['hgetall', key])).exec()
    const out = new Map<number, number>()
    for (const [, value] of results ?? []) {
      for (const [status, count] of Object.entries((value ?? {}) as Record<string, string>)) {
        out.set(Number(status), (out.get(Number(status)) ?? 0) + Number(count))
      }
    }
    return out
  }

  /** Сброс накопленной минуты. Fire-and-forget: сбой Redis теряет минуту, а не запрос. */
  private flush(bucket: number, counts: Map<number, number>, ips: Set<string>): void {
    if (!counts.size) return
    const key = `${PREFIX}${bucket}`
    const pipeline = this.redis.pipeline()
    for (const [status, count] of counts) {
      pipeline.hincrby(key, String(status), count)
    }
    pipeline.expire(key, BUCKET_TTL_SEC)
    if (ips.size) {
      pipeline.pfadd(`${key}:ips`, ...ips)
      pipeline.expire(`${key}:ips`, BUCKET_TTL_SEC)
    }
    void pipeline.exec().catch((error: unknown) => {
      this.logger.debug(`Счётчик ответов не сброшен: ${String(error)}`)
    })
  }
}

function currentBucket(): number {
  return Math.floor(Date.now() / BUCKET_MS)
}

function bucketKeys(windowMinutes: number): string[] {
  const current = currentBucket()
  return Array.from({ length: windowMinutes }, (_, i) => `${PREFIX}${current - i}`)
}
