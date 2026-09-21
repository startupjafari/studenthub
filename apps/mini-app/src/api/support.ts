import { apiGet, apiGetPaged, apiPatch, apiPost } from './client'

// Обращения в поддержку платформы. Типы повторяют ответ `/support`.

export interface SupportTicket {
  id: string
  author: { id: string; firstName: string; lastName: string } | null
  lastMessage: { text: string | null; createdAt: string; fromAuthor: boolean } | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SupportMessage {
  id: string
  content: string | null
  createdAt: string
  sender: { id: string; firstName: string; lastName: string }
}

export async function fetchSupportQueue(
  status: 'open' | 'closed' = 'open',
): Promise<{ items: SupportTicket[]; total: number }> {
  return apiGetPaged<SupportTicket>(`/support?status=${status}&page=1&limit=30`)
}

/** Переписка. Сервер отдаёт свежие сверху — экран разворачивает сам. */
export async function fetchSupportThread(id: string): Promise<SupportMessage[]> {
  const page = await apiGet<{ items?: SupportMessage[] } | SupportMessage[]>(`/support/${id}`)
  return Array.isArray(page) ? page : (page.items ?? [])
}

export async function replyToTicket(id: string, text: string): Promise<SupportMessage> {
  return apiPost<SupportMessage>(`/support/${id}/reply`, { text })
}

export async function closeTicket(id: string): Promise<{ id: string; closed: boolean }> {
  return apiPatch<{ id: string; closed: boolean }>(`/support/${id}/close`, {})
}
