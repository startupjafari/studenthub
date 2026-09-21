import { apiGet, apiGetPaged, apiPatch, apiPost } from './client'

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

export async function fetchSupportQueue(
  status: 'open' | 'closed' = 'open',
  assignee: QueueScope = 'any',
  search?: string,
): Promise<{ items: SupportTicket[]; total: number }> {
  const params = new URLSearchParams({ status, assignee, page: '1', limit: '30' })
  if (search && search.trim().length >= 2) params.set('search', search.trim())
  return apiGetPaged<SupportTicket>(`/support?${params.toString()}`)
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
export async function fetchSupportThread(
  id: string,
): Promise<{ ticket: SupportTicket; messages: SupportMessage[] }> {
  return apiGet<{ ticket: SupportTicket; messages: SupportMessage[] }>(`/support/${id}`)
}

export async function replyToTicket(id: string, text: string): Promise<SupportMessage> {
  return apiPost<SupportMessage>(`/support/${id}/reply`, { text })
}

export async function closeTicket(id: string): Promise<{ id: string; closed: boolean }> {
  return apiPatch<{ id: string; closed: boolean }>(`/support/${id}/close`, {})
}
