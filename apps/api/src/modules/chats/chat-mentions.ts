/**
 * Правило «сообщение обращено к участнику» — одно на режим «только важные» (§17) и на
 * непрочитанные упоминания (ChatAttention): иначе уведомление и значок «@» расходились бы.
 *
 * Упоминания в чате — обычный текст, отдельной сущности у них нет: композер вставляет
 * «@Фамилия Имя» (веб — «@Имя Фамилия»), поэтому ищем эту строку в обоих порядках без учёта
 * регистра. Ответ на сообщение участника — тоже обращение к нему, как в Telegram.
 */

export interface MentionName {
  firstName: string
  lastName: string
}

/** Упомянут ли человек по имени в тексте: «@Фамилия Имя» или «@Имя Фамилия». */
export function mentionsName(content: string, u: MentionName): boolean {
  if (!content.includes('@')) return false
  const text = content.toLowerCase()
  const asComposed = `@${u.lastName} ${u.firstName}`.toLowerCase()
  const reversed = `@${u.firstName} ${u.lastName}`.toLowerCase()
  return text.includes(asComposed) || text.includes(reversed)
}

/** Потолок слов после «@», по которым ищутся кандидаты: длинный текст из «@» не раздует запрос. */
export const MENTION_TOKENS_MAX = 20

/**
 * Первые слова после каждого «@» — по ним выбираются кандидаты среди участников (имя или
 * фамилия начинается с этого слова), а окончательно решает `mentionsName`. Так в большой
 * группе не нужно читать имена всех участников ради одного «@».
 */
export function mentionTokens(content: string): string[] {
  const out = new Set<string>()
  for (const m of content.matchAll(/@([\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*)/gu)) {
    const token = m[1]
    if (!token) continue
    out.add(token.toLowerCase())
    if (out.size >= MENTION_TOKENS_MAX) break
  }
  return [...out]
}
