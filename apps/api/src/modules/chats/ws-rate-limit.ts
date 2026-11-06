/**
 * Корзина токенов на одно WS-соединение (F-F15).
 *
 * У HTTP есть throttler, у отправки сообщения — антифлуд в Redis, а остальные события сокета
 * (`chat:action`, `typing:*`, `chat:join`, `message:read`, правка, удаление) не ограничивались
 * ничем: один клиент мог слать тысячи событий в секунду, и каждое — запрос в базу, а действие
 * в чате — ещё и веерная рассылка до 64 сокетов.
 *
 * Состояние живёт в `client.data` самого сокета: умирает вместе с соединением, чистить нечего,
 * и в Redis за каждым событием ходить не нужно. Обход переподключением ограничен самим
 * подключением — оно проверяет токен и стоит дороже, чем сэкономленные события.
 */
export interface TokenBucketLimit {
  /** Сколько событий подряд можно прислать с полной корзины. */
  capacity: number
  /** Сколько событий в секунду корзина возвращает. */
  refillPerSecond: number
}

interface BucketState {
  tokens: number
  at: number
}

/**
 * Взять токен из корзины `key` в хранилище сокета. `false` — корзина пуста, событие надо
 * отбросить. Пустая корзина не копит долг: отказ токен не тратит.
 */
export function takeToken(
  store: Record<string, unknown>,
  key: string,
  limit: TokenBucketLimit,
  now = Date.now(),
): boolean {
  const prev = store[key] as BucketState | undefined
  const tokens = prev
    ? Math.min(limit.capacity, prev.tokens + ((now - prev.at) / 1000) * limit.refillPerSecond)
    : limit.capacity
  if (tokens < 1) {
    store[key] = { tokens, at: now }
    return false
  }
  store[key] = { tokens: tokens - 1, at: now }
  return true
}
