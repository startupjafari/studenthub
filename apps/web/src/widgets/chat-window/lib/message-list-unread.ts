import type { ChatMessage, MessageReaction } from '../../../entities/chat'

// Что в ленте ждёт внимания помимо обычных непрочитанных — кнопки «к упоминанию» и
// «к реакции» над кнопкой «вниз», как в Telegram. Чистые функции: ленту они не трогают,
// а тестировать их без рендера окна чата дёшево.

export interface MentionTarget {
  id: string
  firstName: string
  lastName: string
}

type MentionRow = Pick<ChatMessage, 'id' | 'senderId' | 'content' | 'createdAt' | 'systemType'> & {
  replyTo: Pick<NonNullable<ChatMessage['replyTo']>, 'senderId'> | null
}

/**
 * Обращено ли сообщение ко мне: ответ на моё сообщение или упоминание по имени.
 *
 * Отдельной сущности «упоминание» у сервера нет — композер вставляет «@Имя Фамилия»
 * обычным текстом, а сервер для режима «только важные» (§17) ищет ровно эту строку в обоих
 * порядках. Здесь — то же правило, чтобы кнопка «@» и уведомление не расходились.
 */
export function mentionsMe(m: MentionRow, me: MentionTarget): boolean {
  if (m.senderId === me.id || m.systemType) return false
  if (m.replyTo?.senderId === me.id) return true
  if (!m.content.includes('@')) return false
  const text = m.content.toLowerCase()
  const asComposed = `@${me.firstName} ${me.lastName}`.trim().toLowerCase()
  const reversed = `@${me.lastName} ${me.firstName}`.trim().toLowerCase()
  return text.includes(asComposed) || text.includes(reversed)
}

/**
 * Непрочитанные упоминания меня в загруженной ленте — по порядку ленты (старые первыми:
 * кнопка ведёт к самому раннему, как в Telegram). Прочитанность — та же отметка
 * «прочитано до», что и у счётчика на кнопке «вниз»: упоминание гаснет, когда проехало
 * через экран. `readUpTo === null` — лента ещё не открыта, считать нечего.
 */
export function unreadMentionIds(
  list: readonly MentionRow[],
  readUpTo: string | null,
  me: MentionTarget | null | undefined,
  dismissed: ReadonlySet<string> = new Set(),
): string[] {
  if (readUpTo === null || !me) return []
  const out: string[] = []
  for (const m of list) {
    if (m.createdAt <= readUpTo || dismissed.has(m.id)) continue
    if (mentionsMe(m, me)) out.push(m.id)
  }
  return out
}

const reactionKey = (r: Pick<MessageReaction, 'userId' | 'emoji'>): string =>
  `${r.userId}:${r.emoji}`

/**
 * Чужие реакции, которых не было в прошлой версии сообщения. Свои не в счёт — их человек
 * поставил сам и видел. Пусто — сообщение не новое для «к реакции».
 */
export function newForeignReactions(
  before: readonly MessageReaction[] | undefined,
  after: readonly MessageReaction[],
  myId: string | undefined,
): MessageReaction[] {
  const known = new Set((before ?? []).map(reactionKey))
  return after.filter((r) => r.userId !== myId && !known.has(reactionKey(r)))
}
