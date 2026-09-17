import { Logger } from '@nestjs/common'
import type { ThrottlerStorage } from '@nestjs/throttler'
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface'

/**
 * Хранилище счётчиков rate limit в Redis, переживающее недоступность Redis.
 *
 * Зачем Redis: `ThrottlerModule` по умолчанию считает попытки в памяти процесса. На одном
 * инстансе это работает, но при горизонтальном масштабировании лимит «5 попыток входа за
 * 15 минут» превращается в «5 × число инстансов»: балансировщик разносит попытки, и каждый
 * процесс считает свои. Именно на логине это и обиднее всего.
 *
 * Зачем обёртка: общий ioredis-клиент настроен падать быстро, а не копить команды в
 * офлайн-очереди (см. redis.module.ts). Без перехвата ошибка хранилища вылетала бы из
 * ThrottlerGuard наружу — то есть недоступный Redis выключал бы приём запросов ЦЕЛИКОМ,
 * на всех эндпоинтах. Кэш не должен ронять платформу: при сбое пропускаем запрос и пишем
 * предупреждение. Это осознанный fail-open — на время сбоя Redis лимиты не действуют, что
 * хуже работающих лимитов, но несравнимо лучше лежащего API.
 *
 * Тот же принцип уже применён в CronLockService («Redis недоступен, идём без лока»).
 */
export class ResilientThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(ResilientThrottlerStorage.name)
  /** Чтобы не заливать лог одинаковой строкой на каждый запрос, пока Redis лежит. */
  private lastWarnAt = 0

  constructor(private readonly inner: ThrottlerStorage) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      return await this.inner.increment(key, ttl, limit, blockDuration, throttlerName)
    } catch (error) {
      this.warnThrottled(error)
      // Одно «попадание» и не заблокирован: guard пропускает запрос дальше.
      return { totalHits: 1, timeToExpire: ttl, isBlocked: false, timeToBlockExpire: 0 }
    }
  }

  private warnThrottled(error: unknown): void {
    const now = Date.now()
    if (now - this.lastWarnAt < 60_000) return
    this.lastWarnAt = now
    this.logger.warn(
      `Redis недоступен — rate limit временно не применяется: ${(error as Error).message}`,
    )
  }
}
