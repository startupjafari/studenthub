import type { Logger } from '@nestjs/common'
import type { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus'

/**
 * Сколько ждём ответа зависимости (B-F23). Без потолка подвисший Redis или MinIO
 * подвешивал весь `GET /health` до таймаута хостинга, и вместо ответа «MinIO лежит»
 * проверка молча не возвращалась вовсе. Три секунды — с запасом выше живого ответа
 * (миллисекунды) и заметно ниже таймаутов uptime-проверки и мини-аппа.
 */
export const HEALTH_PROBE_TIMEOUT_MS = 3000

/**
 * Одна проба зависимости: `up`, если `check` уложился в срок, иначе `down`.
 *
 * Наружу уходит только статус. `GET /health` публичный, а текст ошибок Prisma, ioredis
 * и MinIO содержит внутренние хосты, порты и имена — подробности остаются в журнале.
 */
export async function probe(
  indicators: HealthIndicatorService,
  key: string,
  logger: Logger,
  check: () => Promise<unknown>,
  timeoutMs: number = HEALTH_PROBE_TIMEOUT_MS,
): Promise<HealthIndicatorResult> {
  const indicator = indicators.check(key)
  try {
    await withTimeout(Promise.resolve().then(check), timeoutMs)
    return indicator.up()
  } catch (error) {
    logger.warn(
      `Проверка ${key} не прошла: ${error instanceof Error ? error.message : String(error)}`,
    )
    return indicator.down()
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`нет ответа за ${ms} мс`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
