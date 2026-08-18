// Чистые хелперы чатов (Telegram-стиль): заголовок/инициалы/цвет аватара, тег-категория, время.
// Вынесены из ChatWindow, чтобы список (ConversationList) и сама переписка использовали одно и то же.
import type { ChatListItem, ChatTypeValue } from '../../../entities/chat'

const OFFICIAL_LABEL: Partial<Record<ChatTypeValue, string>> = {
  GROUP_OFFICIAL: 'typeGroupOfficial',
  FACULTY: 'typeFaculty',
  DEAN: 'typeDean',
  SUPPORT: 'typeSupport',
  SUBJECT: 'typeSubject',
}

export function chatTitle(c: ChatListItem, t: (k: string) => string): string {
  if (c.type === 'SAVED') return t('savedMessages')
  if (c.title) return c.title
  if (c.subject) return c.subject
  const key = OFFICIAL_LABEL[c.type]
  return key ? t(key) : t('typePrivate')
}

export function senderName(m: { sender: { firstName: string; lastName: string } }): string {
  return `${m.sender.lastName} ${m.sender.firstName}`.trim()
}

export function chatInitials(title: string): string {
  const parts = title.split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((w) => w[0]?.toUpperCase() ?? '').join('') || '#'
}

const AVATAR_COLORS = [
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-fuchsia-500',
]

export function avatarColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length] ?? 'bg-sky-500'
}

// Тег-категория чата под превью (Telegram-стиль «папок»): i18n-ключ + приглушённая точка-цвет по типу.
export const TYPE_TAG: Record<ChatTypeValue, { key: string; dot: string }> = {
  PRIVATE: { key: 'tagPrivate', dot: 'bg-sky-500' },
  GROUP: { key: 'tagGroup', dot: 'bg-indigo-500' },
  GROUP_OFFICIAL: { key: 'tagGroupOfficial', dot: 'bg-indigo-500' },
  SUBJECT: { key: 'tagSubject', dot: 'bg-emerald-500' },
  FACULTY: { key: 'tagFaculty', dot: 'bg-violet-500' },
  DEAN: { key: 'tagDean', dot: 'bg-amber-500' },
  SUPPORT: { key: 'tagSupport', dot: 'bg-rose-500' },
  EVENT: { key: 'tagEvent', dot: 'bg-teal-500' },
  SAVED: { key: 'tagSaved', dot: 'bg-amber-500' },
}

export function listTime(iso: string, locale: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })
}
