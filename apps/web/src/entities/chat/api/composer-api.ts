import type { ChatChecklistCreateInput, ScheduleMessageInput } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { ChatMessage } from '../model/types'

// Ручки поля ввода в духе Telegram: чек-лист из меню скрепки, отложенная отправка из меню
// кнопки «Отправить». Отдельным файлом от chat-api: у поля ввода свой набор ключей кэша, и он
// не пересекается с лентой и списком чатов.

export const composerKeys = {
  scheduled: (chatId: string) => ['chats', chatId, 'scheduled'] as const,
}

export async function sendChecklistRequest(
  chatId: string,
  input: ChatChecklistCreateInput,
): Promise<ChatMessage> {
  const { data } = await api.post<ChatMessage>(`/chats/${chatId}/checklist`, input)
  return data
}

/** Отложенное сообщение: видно только отправителю, до отправки его можно отменить. */
export interface ScheduledMessage {
  id: string
  chatId: string
  content: string
  replyToId: string | null
  replyQuote: string | null
  silent: boolean
  scheduledAt: string
  createdAt: string
}

export async function fetchScheduledMessages(chatId: string): Promise<ScheduledMessage[]> {
  const { data } = await api.get<ScheduledMessage[]>(`/chats/${chatId}/scheduled`)
  return data
}

export async function scheduleMessageRequest(
  chatId: string,
  input: ScheduleMessageInput,
): Promise<ScheduledMessage> {
  const { data } = await api.post<ScheduledMessage>(`/chats/${chatId}/scheduled`, input)
  return data
}

export async function cancelScheduledRequest(id: string): Promise<void> {
  await api.delete(`/chats/scheduled/${id}`)
}

export async function sendScheduledNowRequest(id: string): Promise<void> {
  await api.post(`/chats/scheduled/${id}/send-now`)
}
