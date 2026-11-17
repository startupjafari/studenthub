import { describe, expect, it } from 'vitest'
import { mentionsMe, newForeignReactions, unreadMentionIds } from './message-list-unread'

const ME = { id: 'me', firstName: 'Айгерим', lastName: 'Сапарова' }
const at = (minute: number): string => `2026-11-17T10:${String(minute).padStart(2, '0')}:00.000Z`
const row = (
  id: string,
  minute: number,
  content: string,
  extra: { senderId?: string; replyTo?: string; system?: string } = {},
) => ({
  id,
  senderId: extra.senderId ?? 'other',
  content,
  createdAt: at(minute),
  systemType: extra.system ?? null,
  replyTo: extra.replyTo ? { senderId: extra.replyTo } : null,
})
const reaction = (userId: string, emoji: string) => ({
  userId,
  emoji,
  user: { id: userId, firstName: 'И', lastName: 'Ф', avatarUrl: null },
})

describe('mentionsMe', () => {
  it('находит «@Имя Фамилия» и обратный порядок без учёта регистра', () => {
    expect(mentionsMe(row('1', 1, 'привет @Айгерим Сапарова!'), ME)).toBe(true)
    expect(mentionsMe(row('2', 1, '@сапарова айгерим глянь'), ME)).toBe(true)
  })

  it('ответ на моё сообщение — тоже обращение ко мне', () => {
    expect(mentionsMe(row('1', 1, 'да', { replyTo: 'me' }), ME)).toBe(true)
  })

  it('своё, служебное и чужое имя — не упоминание', () => {
    expect(mentionsMe(row('1', 1, '@Айгерим Сапарова', { senderId: 'me' }), ME)).toBe(false)
    expect(mentionsMe(row('2', 1, '@Айгерим Сапарова', { system: 'member_added' }), ME)).toBe(false)
    expect(mentionsMe(row('3', 1, '@Данияр Ахметов'), ME)).toBe(false)
  })
})

describe('unreadMentionIds', () => {
  const list = [
    row('a', 1, '@Айгерим Сапарова старое'),
    row('b', 2, 'просто текст'),
    row('c', 3, '@Айгерим Сапарова новое'),
    row('d', 4, 'ответ', { replyTo: 'me' }),
  ]

  it('только новее отметки «прочитано до», по порядку ленты', () => {
    expect(unreadMentionIds(list, at(1), ME)).toEqual(['c', 'd'])
  })

  it('лента не открыта — считать нечего', () => {
    expect(unreadMentionIds(list, null, ME)).toEqual([])
  })

  it('отмеченные «прочитать всё» не возвращаются', () => {
    expect(unreadMentionIds(list, '', ME, new Set(['a', 'd']))).toEqual(['c'])
  })
})

describe('newForeignReactions', () => {
  it('возвращает только появившиеся чужие реакции', () => {
    const before = [reaction('u1', '🔥')]
    const after = [reaction('u1', '🔥'), reaction('u2', '❤️'), reaction('me', '👍')]
    expect(newForeignReactions(before, after, 'me').map((r) => r.userId)).toEqual(['u2'])
  })

  it('снятая реакция ничего нового не даёт', () => {
    expect(newForeignReactions([reaction('u1', '🔥')], [], 'me')).toEqual([])
  })
})
