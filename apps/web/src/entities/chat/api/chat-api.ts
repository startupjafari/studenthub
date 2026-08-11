import type { ChatMessagesQueryInput, CreateChatInput } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { ResponseWithMeta } from '../../../shared/api/instance'
import type {
  BlockedUser,
  ChatListItem,
  ChatMemberInfo,
  ChatMessage,
  ChatReadReceipt,
  PresenceEntry,
} from '../model/types'

export const chatKeys = {
  all: ['chats'] as const,
  list: () => ['chats', 'list'] as const,
  messages: (id: string) => ['chats', id, 'messages'] as const,
  pinned: (id: string) => ['chats', id, 'pinned'] as const,
  presence: (id: string) => ['chats', id, 'presence'] as const,
  members: (id: string) => ['chats', id, 'members'] as const,
  reads: (id: string) => ['chats', id, 'reads'] as const,
  search: (q: string, chatId?: string) => ['chats', 'search', chatId ?? 'all', q] as const,
  blocked: () => ['chats', 'blocked'] as const,
}

export async function fetchChats(): Promise<ChatListItem[]> {
  const { data } = await api.get<ChatListItem[]>('/chats')
  return data
}

export async function createChatRequest(input: CreateChatInput): Promise<{ id: string }> {
  const { data } = await api.post<{ id: string }>('/chats', input)
  return data
}

// Присоединиться к группе по ссылке-приглашению (Ф9+).
export async function joinChatRequest(
  chatId: string,
): Promise<{ id: string; title: string | null }> {
  const { data } = await api.post<{ id: string; title: string | null }>(`/chats/${chatId}/join`)
  return data
}

export interface MessagesPage {
  items: ChatMessage[]
  cursor?: string
  hasNext: boolean
}

export async function fetchMessages(
  chatId: string,
  query: ChatMessagesQueryInput = { limit: 30 },
): Promise<MessagesPage> {
  const res = (await api.get<ChatMessage[]>(`/chats/${chatId}/messages`, {
    params: query,
  })) as ResponseWithMeta & {
    data: ChatMessage[]
  }
  return { items: res.data, cursor: res.meta?.cursor, hasNext: res.meta?.hasNext ?? false }
}

/**
 * Отправка сообщения с вложениями (multipart, Ф9+). Текст опционален при наличии файлов.
 * message:new придёт по WS всем участникам (включая отправителя) — оптимистично не добавляем.
 */
export async function sendMessageWithAttachments(
  chatId: string,
  input: { content?: string; replyToId?: string },
  files: File[],
  onProgress?: (fraction: number) => void,
): Promise<ChatMessage> {
  const form = new FormData()
  if (input.content) form.append('content', input.content)
  if (input.replyToId) form.append('replyToId', input.replyToId)
  for (const file of files) form.append('file', file)
  const { data } = await api.post<ChatMessage>(`/chats/${chatId}/messages`, form, {
    onUploadProgress: onProgress
      ? (e) => onProgress(e.total ? Math.min(1, e.loaded / e.total) : 0)
      : undefined,
  })
  return data
}

export async function searchMessages(
  q: string,
  chatId?: string,
  cursor?: string,
): Promise<MessagesPage> {
  const params: Record<string, string | number> = { q, limit: 30 }
  if (chatId) params.chatId = chatId
  if (cursor) params.cursor = cursor
  const res = (await api.get<ChatMessage[]>('/chats/search', { params })) as ResponseWithMeta & {
    data: ChatMessage[]
  }
  return { items: res.data, cursor: res.meta?.cursor, hasNext: res.meta?.hasNext ?? false }
}

export async function fetchPinned(chatId: string): Promise<ChatMessage[]> {
  const { data } = await api.get<ChatMessage[]>(`/chats/${chatId}/pinned`)
  return data
}

export async function pinMessageRequest(messageId: string): Promise<ChatMessage> {
  const { data } = await api.post<ChatMessage>(`/chats/messages/${messageId}/pin`)
  return data
}

export async function unpinMessageRequest(messageId: string): Promise<ChatMessage> {
  const { data } = await api.delete<ChatMessage>(`/chats/messages/${messageId}/pin`)
  return data
}

export async function fetchAttachmentUrl(fileId: string): Promise<string> {
  const { data } = await api.get<string>(`/chats/attachments/${fileId}/url`)
  return data
}

export async function toggleReactionRequest(
  messageId: string,
  emoji: string,
): Promise<ChatMessage> {
  const { data } = await api.post<ChatMessage>(`/chats/messages/${messageId}/reactions`, { emoji })
  return data
}

export async function forwardMessageRequest(
  targetChatId: string,
  messageId: string,
): Promise<ChatMessage> {
  const { data } = await api.post<ChatMessage>(`/chats/${targetChatId}/forward`, { messageId })
  return data
}

// Поделиться постом в чат превью-карточкой (share-to-chat). comment — необязательная подпись.
export async function sharePostRequest(
  targetChatId: string,
  postId: string,
  comment?: string,
): Promise<ChatMessage> {
  const { data } = await api.post<ChatMessage>(`/chats/${targetChatId}/share-post`, {
    postId,
    comment: comment?.trim() || undefined,
  })
  return data
}

export async function exportChatRequest(chatId: string): Promise<ChatMessage[]> {
  const { data } = await api.get<ChatMessage[]>(`/chats/${chatId}/export`)
  return data
}

export async function setChatMutedRequest(chatId: string, muted: boolean): Promise<void> {
  if (muted) await api.post(`/chats/${chatId}/mute`)
  else await api.delete(`/chats/${chatId}/mute`)
}

// Закрепить/открепить чат «у себя» (сверху списка, Telegram-стиль).
export async function setChatPinnedRequest(chatId: string, pinned: boolean): Promise<void> {
  if (pinned) await api.post(`/chats/${chatId}/pin`)
  else await api.delete(`/chats/${chatId}/pin`)
}

export async function fetchPresence(chatId: string): Promise<PresenceEntry[]> {
  const { data } = await api.get<PresenceEntry[]>(`/chats/${chatId}/presence`)
  return data
}

export async function fetchChatMembers(chatId: string): Promise<ChatMemberInfo[]> {
  const { data } = await api.get<ChatMemberInfo[]>(`/chats/${chatId}/members`)
  return data
}

// Статусы прочтения участниками (#6): кто и до какого момента прочитал.
export async function fetchReadReceipts(chatId: string): Promise<ChatReadReceipt[]> {
  const { data } = await api.get<ChatReadReceipt[]>(`/chats/${chatId}/reads`)
  return data
}

// Сохранить/очистить черновик сообщения на сервере (#3, синхронизация между устройствами).
export async function saveChatDraft(chatId: string, text: string): Promise<void> {
  await api.put(`/chats/${chatId}/draft`, { text })
}

export async function addChatMemberRequest(chatId: string, userId: string): Promise<void> {
  await api.post(`/chats/${chatId}/members`, { userId })
}

export async function removeChatMemberRequest(chatId: string, userId: string): Promise<void> {
  await api.delete(`/chats/${chatId}/members/${userId}`)
}

// Бан/разбан участника группы (только создатель).
export async function banChatMemberRequest(chatId: string, userId: string): Promise<void> {
  await api.post(`/chats/${chatId}/members/${userId}/ban`)
}

export async function unbanChatMemberRequest(chatId: string, userId: string): Promise<void> {
  await api.delete(`/chats/${chatId}/members/${userId}/ban`)
}

// Личная блокировка пользователя (запрет переписки в личном чате).
export async function blockUserRequest(userId: string): Promise<void> {
  await api.post(`/chats/blocks/${userId}`)
}

export async function unblockUserRequest(userId: string): Promise<void> {
  await api.delete(`/chats/blocks/${userId}`)
}

// Аватар группы: загрузка изображения / удаление (только создатель).
export async function setChatAvatarRequest(
  chatId: string,
  file: File,
): Promise<{ id: string; avatarUrl: string }> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<{ id: string; avatarUrl: string }>(
    `/chats/${chatId}/avatar`,
    form,
  )
  return data
}

export async function removeChatAvatarRequest(chatId: string): Promise<void> {
  await api.delete(`/chats/${chatId}/avatar`)
}

// Название группы (админ).
export async function editChatTitleRequest(chatId: string, title: string): Promise<void> {
  await api.patch(`/chats/${chatId}`, { title })
}

// Удалить чат / покинуть группу.
export async function deleteChatRequest(chatId: string): Promise<{ deleted: boolean }> {
  const { data } = await api.delete<{ deleted: boolean }>(`/chats/${chatId}`)
  return data
}

// Очистить историю «для меня».
export async function clearChatRequest(chatId: string): Promise<void> {
  await api.post(`/chats/${chatId}/clear`)
}

// Назначить/снять админа (только создатель).
export async function setChatAdminRequest(
  chatId: string,
  userId: string,
  isAdmin: boolean,
): Promise<void> {
  if (isAdmin) await api.post(`/chats/${chatId}/members/${userId}/admin`)
  else await api.delete(`/chats/${chatId}/members/${userId}/admin`)
}

// Передать владение группой (только создатель).
export async function transferOwnershipRequest(chatId: string, userId: string): Promise<void> {
  await api.post(`/chats/${chatId}/transfer/${userId}`)
}

// Список заблокированных мной пользователей.
export async function fetchBlockedUsers(): Promise<BlockedUser[]> {
  const { data } = await api.get<BlockedUser[]>('/chats/blocks')
  return data
}
