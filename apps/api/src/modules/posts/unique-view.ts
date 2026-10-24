import type Redis from 'ioredis'

/**
 * Учёт просмотров постов и статей: один просмотр на зрителя в сутки.
 *
 * Раньше каждое открытие лайтбокса или читалки прибавляло единицу: счётчик накручивался
 * пролистыванием туда-обратно, а популярный пост получал UPDATE одной и той же строки на
 * каждое открытие — конкурентные блокировки строки под нагрузкой. Теперь UPDATE идёт только
 * на первый просмотр зрителя за сутки.
 *
 * Кто уже смотрел — множество в Redis на объект и день (`views:post:<id>:<YYYY-MM-DD>`), а не
 * ключ на пару «зритель + объект»: множество хранится компактно, а ключей на порядок меньше.
 * Множество живёт двое суток — за это время день, к которому оно относится, гарантированно
 * закончился, и в Redis не копятся вчерашние списки.
 *
 * Redis недоступен — просмотр засчитывается, как раньше: потерять просмотры хуже, чем на
 * время сбоя вернуться к прежнему счёту.
 */
export const VIEW_DEDUPE_TTL_SEC = 2 * 24 * 60 * 60

export type ViewedKind = 'post' | 'article'

export function viewDedupeKey(kind: ViewedKind, id: string, now: Date): string {
  return `views:${kind}:${id}:${now.toISOString().slice(0, 10)}`
}

/** Первый ли это просмотр зрителя за сутки (и тогда его надо засчитать). */
export async function isFirstViewToday(
  redis: Redis,
  kind: ViewedKind,
  id: string,
  viewerId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const key = viewDedupeKey(kind, id, now)
  try {
    // Одной транзакцией: множество без срока жизни осталось бы в Redis навсегда.
    const results = await redis.multi().sadd(key, viewerId).expire(key, VIEW_DEDUPE_TTL_SEC).exec()
    const [addError, added] = results?.[0] ?? [null, 1]
    if (addError) return true
    return added !== 0
  } catch {
    return true
  }
}
