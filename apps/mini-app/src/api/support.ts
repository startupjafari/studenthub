import { apiGet, apiGetPaged, apiPatch, apiPost, apiUpload } from './client'

// Обращения в поддержку платформы. Типы повторяют ответ `/support`.

export interface SupportTicket {
  id: string
  author: { id: string; firstName: string; lastName: string } | null
  lastMessage: { text: string | null; createdAt: string; fromAuthor: boolean } | null
  closedAt: string | null
  /** Кто разбирает. null — обращение свободно. */
  assigneeId: string | null
  assignee: { id: string; firstName: string; lastName: string } | null
  firstReplyAt: string | null
  /** О чём обращение. Проставляет поддержка; пустой массив — ещё не разбирали. */
  tags: SupportTag[]
  createdAt: string
  updatedAt: string
}

export interface SupportMessage {
  id: string
  content: string | null
  createdAt: string
  sender: { id: string; firstName: string; lastName: string }
  /** Вложения. Скачать их из мини-аппа нельзя, но знать об их наличии модератор обязан. */
  media?: { id: string; name: string | null }[]
}

export type QueueScope = 'any' | 'mine' | 'free'

/**
 * Теги обращения. Список закрытый и повторяет серверный (`SUPPORT_TAGS`): свободные теги
 * за неделю разрастаются в «оценки», «оценка», «Оценки!», и сводка «о чём спрашивают
 * чаще» перестаёт складываться.
 */
export const SUPPORT_TAGS = ['ACCESS', 'DATA', 'DOCS', 'BUG', 'FEATURE', 'ABUSE', 'OTHER'] as const
export type SupportTag = (typeof SUPPORT_TAGS)[number]

/**
 * Ключи подписей тегов в словаре: `supportTagAccess` и так далее. Без аннотации типа
 * намеренно — литеральные значения проверяются на существование ключа в `t()`.
 */
export const SUPPORT_TAG_KEY = {
  ACCESS: 'supportTagAccess',
  DATA: 'supportTagData',
  DOCS: 'supportTagDocs',
  BUG: 'supportTagBug',
  FEATURE: 'supportTagFeature',
  ABUSE: 'supportTagAbuse',
  OTHER: 'supportTagOther',
} as const

export async function fetchSupportQueue(
  status: 'open' | 'closed' = 'open',
  assignee: QueueScope = 'any',
  search?: string,
  tag?: SupportTag,
): Promise<{ items: SupportTicket[]; total: number }> {
  const params = new URLSearchParams({ status, assignee, page: '1', limit: '30' })
  if (search && search.trim().length >= 2) params.set('search', search.trim())
  if (tag) params.set('tag', tag)
  return apiGetPaged<SupportTicket>(`/support?${params.toString()}`)
}

/**
 * О чём спрашивают чаще — счётчики за 30 дней. Ради этого числа теги и заводились:
 * «поддержка отвечает на одно и то же» превращается в «шестьдесят обращений про доступ
 * за месяц», то есть в задачу продукту, а не в ощущение.
 */
export async function fetchTagCounts(): Promise<{ tag: SupportTag; count: number }[]> {
  return apiGet<{ tag: SupportTag; count: number }[]>('/support/tags')
}

/** Теги заменяются целиком: «добавить» и «убрать» двумя ручками разъезжаются. */
export async function setTicketTags(
  id: string,
  tags: SupportTag[],
): Promise<{ tags: SupportTag[] }> {
  return apiPatch<{ tags: SupportTag[] }>(`/support/${id}/tags`, { tags })
}

/**
 * Заготовки ответов. Подставляются в поле, а не отправляются сразу: заготовка — начало
 * ответа, а не ответ. Треть обращений при этом повторяется дословно, и набирать их
 * с телефона — самое дорогое, что есть в мини-аппе.
 */
export const REPLY_TEMPLATES = [
  { key: 'taken', labelKey: 'supportTplTaken', textKey: 'supportTplTakenText' },
  { key: 'details', labelKey: 'supportTplDetails', textKey: 'supportTplDetailsText' },
  { key: 'done', labelKey: 'supportTplDone', textKey: 'supportTplDoneText' },
] as const

/** Взять обращение себе или отдать обратно. Перехватить чужое сервер не даст. */
export async function assignTicket(
  id: string,
  take: boolean,
): Promise<{ assigneeId: string | null }> {
  return apiPatch<{ assigneeId: string | null }>(`/support/${id}/assign?take=${take}`, {})
}

/**
 * Обращение вместе с перепиской. Карточка приходит рядом с сообщениями, потому что экран
 * открывается и по ссылке из уведомления — а там очереди, откуда взять автора, нет.
 * Сообщения приходят свежими сверху; экран разворачивает их сам.
 */
export interface SupportThread {
  ticket: SupportTicket
  messages: SupportMessage[]
  /** Сколько веток склеено сюда: их переписка уже внутри `messages`. */
  mergedCount: number
  /** Другие обращения того же человека — то, с чем эту ветку можно склеить. */
  siblings: { id: string; createdAt: string; closed: boolean }[]
}

export async function fetchSupportThread(id: string): Promise<SupportThread> {
  return apiGet<SupportThread>(`/support/${id}`)
}

/**
 * Склеить обращение с другим обращением того же человека. Сообщения не переносятся —
 * ветка закрывается, а её переписка читается вместе с целевой: разговор виден целиком,
 * и ничья история при этом не переписана.
 */
export async function mergeTicket(id: string, intoId: string): Promise<{ mergedInto: string }> {
  return apiPost<{ mergedInto: string }>(`/support/${id}/merge`, { intoId })
}

export async function replyToTicket(id: string, text: string): Promise<SupportMessage> {
  return apiPost<SupportMessage>(`/support/${id}/reply`, { text })
}

/** Позвать администратора. Уведомление идёт мимо дежурства и тихих часов. */
export async function escalateTicket(id: string): Promise<{ escalated: boolean }> {
  return apiPost<{ escalated: boolean }>(`/support/${id}/escalate`, {})
}

export async function closeTicket(id: string): Promise<{ id: string; closed: boolean }> {
  return apiPatch<{ id: string; closed: boolean }>(`/support/${id}/close`, {})
}

/**
 * Голосовой ответ. Уходит отдельной ручкой, а не общим маршрутом чатов: тот открыл бы
 * токену мини-аппа все чаты сотрудника, включая личные.
 */
export async function sendVoiceReply(id: string, file: File): Promise<SupportMessage> {
  const form = new FormData()
  form.append('file', file)
  return apiUpload<SupportMessage>(`/support/${id}/voice`, form)
}
