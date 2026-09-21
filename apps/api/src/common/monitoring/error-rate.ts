import type Redis from 'ioredis'

// Счётчик серверных ошибок по минутным корзинам.
//
// Это возвращение того, что в начале эпика было удалено как мёртвый код: прежний счётчик
// писал в Redis на КАЖДЫЙ ответ и не имел ни одного читателя. Разница принципиальная —
// здесь считаются только 5xx (на здоровой платформе это единицы в сутки, а не тысячи в
// минуту), и у счётчика есть читатель: ежечасный cron, уведомляющий о всплеске.
//
// Минутные корзины с коротким TTL: «сколько ошибок за последний час» складывается из
// шестидесяти ключей, а старые исчезают сами, без уборки.

const KEY_PREFIX = 'errors:5xx:'
const BUCKET_TTL_SEC = 90 * 60

function bucketKey(at: Date): string {
  return `${KEY_PREFIX}${Math.floor(at.getTime() / 60_000)}`
}

/** Записать серверную ошибку. Отказ Redis глушится: счётчик не должен ломать ответ. */
export async function recordServerError(redis: Redis, at: Date = new Date()): Promise<void> {
  try {
    const key = bucketKey(at)
    await redis.multi().incr(key).expire(key, BUCKET_TTL_SEC).exec()
  } catch {
    // Счётчик — наблюдение, а не работа: его отказ не повод ронять обработку ошибки.
  }
}

/** Сколько серверных ошибок за последние `minutes` минут. */
export async function countServerErrors(
  redis: Redis,
  minutes: number,
  now: Date = new Date(),
): Promise<number> {
  const keys = Array.from({ length: minutes }, (_, index) =>
    bucketKey(new Date(now.getTime() - index * 60_000)),
  )
  const values = await redis.mget(keys).catch(() => [])
  return values.reduce<number>((sum, value) => sum + Number(value ?? 0), 0)
}
