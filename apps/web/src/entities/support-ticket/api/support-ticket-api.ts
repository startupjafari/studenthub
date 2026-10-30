import type { SupportQueueQueryInput, SupportTag } from '@studenthub/shared-schemas'
import {
  api,
  getPaged,
  type MediaStatus,
  type Paged,
  type ResponseWithMeta,
} from '../../../shared/api'

// Обращения в поддержку платформы — рабочее место команды платформы (админ и модератор
// платформы). Типы повторяют ответ `/support`; тот же контракт читает мини-апп.

export interface SupportPerson {
  id: string
  firstName: string
  lastName: string
}

export interface SupportTicket {
  id: string
  author: SupportPerson | null
  lastMessage: { text: string | null; createdAt: string; fromAuthor: boolean } | null
  closedAt: string | null
  /** Кто разбирает. null — обращение свободно. */
  assigneeId: string | null
  assignee: SupportPerson | null
  firstReplyAt: string | null
  tags: SupportTag[]
  createdAt: string
  updatedAt: string
}

export interface SupportMessage {
  id: string
  content: string | null
  createdAt: string
  sender: SupportPerson
  /** Вложения — в форме вложения сообщения чата: обращение и есть чат, показываются они тем же видом. */
  media?: SupportAttachment[]
  /** Реакции и цитата ответа — тоже как у сообщения чата (переписку отдаёт домен чатов). */
  reactions?: SupportReaction[]
  replyTo?: SupportReplyPreview | null
}

export interface SupportReaction {
  emoji: string
  userId: string
  user: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
}

/** Сообщение, на которое ответили. У удалённого оригинала текст пустой и есть `deletedAt`. */
export interface SupportReplyPreview {
  id: string
  content: string
  deletedAt?: string | null
  sender: { id: string; firstName: string; lastName: string }
}

export interface SupportAttachment {
  id: string
  mime: string
  size: number
  name?: string | null
  spoiler?: boolean
  asDocument?: boolean
  width?: number | null
  height?: number | null
  placeholder?: string | null
  mediaStatus?: MediaStatus
  durationMs?: number | null
}

/** Обращение с перепиской (свежие сверху), числом склеенных веток и соседними обращениями. */
export interface SupportThread {
  ticket: SupportTicket
  messages: SupportMessage[]
  /** Курсор истории обращения до загруженных 50 сообщений; null — раньше ничего нет. */
  earlierCursor?: string | null
  mergedCount: number
  siblings: { id: string; createdAt: string; closed: boolean }[]
}

export const supportKeys = {
  all: ['support-desk'] as const,
  queue: (params: Partial<SupportQueueQueryInput>) => ['support-desk', 'queue', params] as const,
  thread: (id: string) => ['support-desk', 'thread', id] as const,
  tags: () => ['support-desk', 'tags'] as const,
}

export function fetchSupportQueue(
  params: Partial<SupportQueueQueryInput> = {},
): Promise<Paged<SupportTicket>> {
  return getPaged<SupportTicket>('/support', { page: 1, limit: 30, ...params })
}

export async function fetchSupportTagCounts(): Promise<{ tag: SupportTag; count: number }[]> {
  const { data } = await api.get<{ tag: SupportTag; count: number }[]>('/support/tags')
  return data
}

export async function fetchSupportThread(id: string): Promise<SupportThread> {
  const { data } = await api.get<SupportThread>(`/support/${id}`)
  return data
}

/**
 * Более ранние сообщения обращения — обычной историей чата: обращение и есть чат, а
 * сотрудник платформы в нём участник. Свежие сверху, `cursor` — для следующей порции.
 */
export async function fetchSupportEarlierMessages(
  id: string,
  cursor: string,
): Promise<{ items: SupportMessage[]; cursor: string | null }> {
  const res = (await api.get<SupportMessage[]>(`/chats/${id}/messages`, {
    params: { cursor, limit: 50 },
  })) as ResponseWithMeta & { data: SupportMessage[] }
  return { items: res.data, cursor: res.meta?.hasNext ? (res.meta.cursor ?? null) : null }
}

export async function replySupportRequest(id: string, text: string): Promise<SupportMessage> {
  const { data } = await api.post<SupportMessage>(`/support/${id}/reply`, { text })
  return data
}

/** Взять обращение себе или отдать обратно. Перехватить чужое сервер не даст. */
export async function assignSupportRequest(id: string, take: boolean): Promise<void> {
  await api.patch(`/support/${id}/assign`, {}, { params: { take } })
}

/** Теги заменяются целиком (не больше трёх). */
export async function setSupportTagsRequest(id: string, tags: SupportTag[]): Promise<void> {
  await api.patch(`/support/${id}/tags`, { tags })
}

export async function mergeSupportRequest(id: string, intoId: string): Promise<void> {
  await api.post(`/support/${id}/merge`, { intoId })
}

/** Позвать администраторов: уведомление идёт мимо дежурства и тихих часов. */
export async function escalateSupportRequest(id: string): Promise<void> {
  await api.post(`/support/${id}/escalate`, {})
}

export async function closeSupportRequest(id: string): Promise<void> {
  await api.patch(`/support/${id}/close`, {})
}
