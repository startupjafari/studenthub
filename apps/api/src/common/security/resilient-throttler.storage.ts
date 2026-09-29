import { Logger } from '@nestjs/common'
import type { ThrottlerStorage } from '@nestjs/throttler'
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface'

/**
 * Счётчик попыток в памяти процесса — запасной путь на время недоступности Redis.
 *
 * Своя реализация, а не `ThrottlerStorageService` из пакета, по одной причине: тот на
 * каждое попадание заводит `setTimeout` и снимает их только в `onApplicationShutdown`,
 * то есть у провайдера Nest. Наш экземпляр создаётся фабрикой внутри опций
 * ThrottlerModule и провайдером не является — хук ему никто не вызовет, и после сбоя
 * Redis процесс на выходе ждал бы висящие таймеры (до 15 минут на окне логина).
 * Деплой, который не может завершиться, — слишком дорогая плата за фолбэк.
 *
 * Здесь время хранится отметками, а просрочка вычисляется при обращении. Таймеров нет,
 * поэтому и снимать нечего. Окно фиксированное (как у Redis-хранилища пакета).
 */
class InMemoryWindowCounter {
  private readonly entries = new Map<
    string,
    { hits: number; expiresAt: number; blockedUntil: number }
  >()

  /**
   * Подчищаем просроченные записи не по таймеру, а раз в N обращений: сбой Redis обычно
   * короткий, но при длинном и разнообразном трафике (ключ на пользователя и маршрут)
   * карта иначе растёт всё время сбоя и не освобождается.
   */
  private sinceSweep = 0
  private static readonly SWEEP_EVERY = 1000

  increment(
    key: string,
    ttlMs: number,
    limit: number,
    blockDurationMs: number,
  ): ThrottlerStorageRecord {
    const now = Date.now()
    this.maybeSweep(now)

    let entry = this.entries.get(key)
    if (!entry || (now >= entry.expiresAt && now >= entry.blockedUntil)) {
      entry = { hits: 0, expiresAt: now + ttlMs, blockedUntil: 0 }
      this.entries.set(key, entry)
    }

    if (now < entry.blockedUntil) {
      return {
        totalHits: entry.hits,
        timeToExpire: toSeconds(entry.expiresAt - now),
        isBlocked: true,
        timeToBlockExpire: toSeconds(entry.blockedUntil - now),
      }
    }

    entry.hits += 1
    if (entry.hits > limit) {
      entry.blockedUntil = now + (blockDurationMs || ttlMs)
    }

    return {
      totalHits: entry.hits,
      timeToExpire: toSeconds(entry.expiresAt - now),
      isBlocked: entry.hits > limit,
      timeToBlockExpire: toSeconds(entry.blockedUntil - now),
    }
  }

  private maybeSweep(now: number): void {
    this.sinceSweep += 1
    if (this.sinceSweep < InMemoryWindowCounter.SWEEP_EVERY) return
    this.sinceSweep = 0
    for (const [key, entry] of this.entries) {
      if (now >= entry.expiresAt && now >= entry.blockedUntil) this.entries.delete(key)
    }
  }
}

/** Контракт хранилища меряет остаток в секундах, внутренние отметки — в миллисекундах. */
function toSeconds(ms: number): number {
  return ms > 0 ? Math.ceil(ms / 1000) : 0
}

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
 * на всех эндпоинтах. Кэш не должен ронять платформу.
 *
 * Что происходит при сбое: считаем в памяти процесса. Раньше здесь возвращался свободный
 * пропуск (`totalHits: 1`), и это была дыра с неприятным свойством — достаточно дождаться
 * (или устроить) сбой Redis, чтобы разом отключить ВСЕ лимиты платформы, включая перебор
 * пароля на `/auth/login`. Память процесса даёт то самое «5 × число инстансов»: хуже
 * точного счёта, но несравнимо лучше отсутствия счёта, и API при этом остаётся живым.
 *
 * Тот же принцип уже применён в CronLockService («Redis недоступен, идём без лока»), но
 * там цена ошибки — двойной прогон задачи, а не открытый вход.
 */
export class ResilientThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(ResilientThrottlerStorage.name)
  /** Чтобы не заливать лог одинаковой строкой на каждый запрос, пока Redis лежит. */
  private lastWarnAt = 0
  /**
   * Запасной счётчик живёт всё время работы процесса, а не создаётся на каждый сбой:
   * сбои Redis приходят сериями, и пересоздание обнуляло бы счётчик ровно тогда, когда
   * он единственный работает. Пока Redis жив, сюда не заходят и память не растёт.
   */
  private readonly fallback = new InMemoryWindowCounter()

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
      return this.fallback.increment(key, ttl, limit, blockDuration)
    }
  }

  private warnThrottled(error: unknown): void {
    const now = Date.now()
    if (now - this.lastWarnAt < 60_000) return
    this.lastWarnAt = now
    this.logger.warn(
      `Redis недоступен — rate limit считается в памяти процесса: ${(error as Error).message}`,
    )
  }
}
