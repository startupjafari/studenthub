import type { ChatMessage, ChatUpdates } from '../../../entities/chat'

// Слияние дельты догона (GET /chats/:id/updates) с кэшем сообщений React Query.
// Вынесено из chat-window отдельным чистым модулем: логика склейки — самая ошибкоопасная часть
// реконнекта, а тестировать её без рендера всего окна чата гораздо дешевле.

/** Последний известный клиенту seq — точка, с которой сервер отдаёт разницу. */
export function latestSeqOf(messages: readonly ChatMessage[] | undefined): number {
  if (!messages?.length) return 0
  // Оптимистичные пузыри ещё не имеют серверного seq — их пропускаем.
  return messages.reduce((max, message) => (message.seq > max ? message.seq : max), 0)
}

/**
 * Применяет дельту к кэшу: дописывает новые (с дедупом по id), заменяет изменённые, убирает
 * удалённые. Порядок сообщений в кэше — по возрастанию createdAt, новые всегда в хвосте.
 * Если дельта пустая, возвращается ИСХОДНЫЙ массив — ссылка не меняется, лишнего рендера нет.
 */
export function mergeUpdates(
  cached: readonly ChatMessage[] | undefined,
  delta: ChatUpdates,
): ChatMessage[] {
  const current = cached ?? []
  const hasChanges =
    delta.created.length > 0 || delta.mutated.length > 0 || delta.deletedIds.length > 0
  if (!hasChanges) return current as ChatMessage[]

  const deleted = new Set(delta.deletedIds)
  const patched = new Map(delta.mutated.map((message) => [message.id, message]))
  // Сообщение могло прийти и по WS, пока запрос дельты был в полёте.
  const known = new Set(current.map((message) => message.id))

  const result = current
    .filter((message) => !deleted.has(message.id))
    .map((message) => patched.get(message.id) ?? message)

  for (const message of delta.created) {
    if (known.has(message.id) || deleted.has(message.id)) continue
    result.push(message)
  }

  return result
}
