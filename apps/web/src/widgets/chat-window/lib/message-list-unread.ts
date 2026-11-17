import type { ChatAttentionCounts, ChatAttentionQueue, ChatListItem } from '../../../entities/chat'

// Что в ленте ждёт внимания помимо обычных непрочитанных — кнопки «к упоминанию» и
// «к реакции» над кнопкой «вниз», значки «@» и «♥» в списке чатов, как в Telegram.
//
// Источник — сервер: счётчики приходят в элементе списка (unreadMentionsCount /
// unreadReactionsCount) и событием `chat:attention`, очередь целей — отдельным запросом.
// Здесь — чистые функции над этими данными: ленту они не трогают, тестировать их дёшево.

export type AttentionKey = keyof ChatAttentionCounts

/**
 * Цели очереди, которые ещё не прочитаны на этом устройстве, — по порядку ленты (старые
 * первыми: кнопка ведёт к самому раннему). Прочитанные уходят на сервер пачкой с задержкой,
 * и до ответа очередь их уже не показывает.
 */
export function pendingTargets(
  queue: ChatAttentionQueue | undefined,
  read: ReadonlySet<string>,
): string[] {
  if (!queue) return []
  return queue.items.map((i) => i.messageId).filter((id) => !read.has(id))
}

/**
 * Устарела ли очередь: сервер насчитал не столько, сколько ожидается после локальных
 * прочтений. Пришло новое упоминание, реакцию сняли или прочитали на другом устройстве —
 * очередь надо перезапросить. Совпало (эхо собственного прочтения) — запрос лишний.
 */
export function isQueueStale(
  serverCount: number,
  queue: ChatAttentionQueue | undefined,
  read: ReadonlySet<string>,
): boolean {
  if (!queue) return serverCount > 0
  const readHere = queue.items.reduce((n, i) => (read.has(i.messageId) ? n + 1 : n), 0)
  return serverCount !== Math.max(0, queue.count - readHere)
}

/** Записать счётчики чата в список (событие `chat:attention`, ответ на прочтение). */
export function withAttentionCounts(
  list: ChatListItem[],
  chatId: string,
  counts: Partial<ChatAttentionCounts>,
): ChatListItem[] {
  let changed = false
  const next = list.map((c) => {
    if (c.id !== chatId) return c
    const m = counts.unreadMentionsCount ?? c.unreadMentionsCount ?? 0
    const r = counts.unreadReactionsCount ?? c.unreadReactionsCount ?? 0
    if (m === (c.unreadMentionsCount ?? 0) && r === (c.unreadReactionsCount ?? 0)) return c
    changed = true
    return { ...c, unreadMentionsCount: m, unreadReactionsCount: r }
  })
  return changed ? next : list
}

/** Оптимистично уменьшить счётчик чата на `by` (не ниже нуля) — до ответа сервера. */
export function withAttentionRead(
  list: ChatListItem[],
  chatId: string,
  key: AttentionKey,
  by: number | 'all',
): ChatListItem[] {
  const chat = list.find((c) => c.id === chatId)
  if (!chat) return list
  const cur = chat[key] ?? 0
  return withAttentionCounts(list, chatId, { [key]: by === 'all' ? 0 : Math.max(0, cur - by) })
}
