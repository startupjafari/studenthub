import type {
  ChatMessagesQueryInput,
  CreateChatInput,
  CreateChatPollInput,
} from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { ResponseWithMeta } from '../../../shared/api/instance'
import type {
  BlockedUser,
  ChatLinkItem,
  ChatListItem,
  ChatMediaItem,
  ChatMemberInfo,
  ChatMessage,
  ChatReadReceipt,
  PollResults,
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
  media: (id: string, type: string) => ['chats', id, 'media', type] as const,
  links: (id: string) => ['chats', id, 'links'] as const,
  poll: (pollId: string) => ['chats', 'poll', pollId] as const,
  blocked: () => ['chats', 'blocked'] as const,
}

// «Сохранённые» (§15): id личного self-chat (создаётся на первом обращении).
export async function fetchSavedChat(): Promise<{ id: string }> {
  const { data } = await api.get<{ id: string }>('/chats/saved')
  return data
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
  // Двунаправленная пагинация (jump-to-message): курсор/наличие более НОВЫХ сообщений.
  prevCursor?: string
  hasPrev: boolean
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
  return {
    items: res.data,
    cursor: res.meta?.cursor,
    hasNext: res.meta?.hasNext ?? false,
    prevCursor: res.meta?.prevCursor,
    hasPrev: res.meta?.hasPrev ?? false,
  }
}

// Разница по чату с позиции клиента (докачка после обрыва связи вместо перезапроса истории).
export interface ChatUpdates {
  created: ChatMessage[]
  mutated: ChatMessage[]
  deletedIds: string[]
  latestSeq: number
  // Разрыв больше серверного лимита — склеить ленту нельзя, нужен полный рефетч истории.
  overflow: boolean
}

export async function fetchChatUpdates(
  chatId: string,
  since: number,
  sinceTs?: string,
): Promise<ChatUpdates> {
  const { data } = await api.get<ChatUpdates>(`/chats/${chatId}/updates`, {
    params: { since, sinceTs },
  })
  return data
}

/**
 * Отправка сообщения с вложениями (multipart, Ф9+). Текст опционален при наличии файлов.
 * message:new придёт по WS всем участникам (включая отправителя) — оптимистично не добавляем.
 */
export async function sendMessageWithAttachments(
  chatId: string,
  input: { content?: string; replyToId?: string; spoiler?: boolean },
  files: File[],
  onProgress?: (fraction: number) => void,
): Promise<ChatMessage> {
  const form = new FormData()
  if (input.content) form.append('content', input.content)
  if (input.replyToId) form.append('replyToId', input.replyToId)
  if (input.spoiler) form.append('spoiler', 'true')
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
  filters?: { senderId?: string; hasFile?: boolean },
): Promise<MessagesPage> {
  const params: Record<string, string | number | boolean> = { q, limit: 30 }
  if (chatId) params.chatId = chatId
  if (cursor) params.cursor = cursor
  if (filters?.senderId) params.senderId = filters.senderId
  if (filters?.hasFile) params.hasFile = true
  const res = (await api.get<ChatMessage[]>('/chats/search', { params })) as ResponseWithMeta & {
    data: ChatMessage[]
  }
  return {
    items: res.data,
    cursor: res.meta?.cursor,
    hasNext: res.meta?.hasNext ?? false,
    hasPrev: false,
  }
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

// Опросы в чате (§38–39).
export async function createChatPoll(
  chatId: string,
  input: CreateChatPollInput,
): Promise<ChatMessage> {
  const { data } = await api.post<ChatMessage>(`/chats/${chatId}/poll`, input)
  return data
}
export async function fetchPollResults(pollId: string): Promise<PollResults> {
  const { data } = await api.get<PollResults>(`/chats/polls/${pollId}`)
  return data
}
export async function votePollRequest(pollId: string, optionIds: string[]): Promise<PollResults> {
  const { data } = await api.post<PollResults>(`/chats/polls/${pollId}/vote`, { optionIds })
  return data
}

// Общие материалы чата (§23): вложения по типу и ссылки.
export interface ChatMediaPage {
  items: ChatMediaItem[]
  cursor?: string
  hasNext: boolean
}
export async function fetchChatMedia(
  chatId: string,
  type: 'media' | 'file' | 'voice',
  cursor?: string,
): Promise<ChatMediaPage> {
  const params: Record<string, string | number> = { type, limit: 30 }
  if (cursor) params.cursor = cursor
  const res = (await api.get<ChatMediaItem[]>(`/chats/${chatId}/media`, {
    params,
  })) as ResponseWithMeta & { data: ChatMediaItem[] }
  return { items: res.data, cursor: res.meta?.cursor, hasNext: res.meta?.hasNext ?? false }
}

export interface ChatLinksPage {
  items: ChatLinkItem[]
  cursor?: string
  hasNext: boolean
}
export async function fetchChatLinks(chatId: string, cursor?: string): Promise<ChatLinksPage> {
  const params: Record<string, string | number> = { limit: 30 }
  if (cursor) params.cursor = cursor
  const res = (await api.get<ChatLinkItem[]>(`/chats/${chatId}/links`, {
    params,
  })) as ResponseWithMeta & { data: ChatLinkItem[] }
  return { items: res.data, cursor: res.meta?.cursor, hasNext: res.meta?.hasNext ?? false }
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

// §17: muted=true заглушает (minutes — на время, иначе навсегда); false — включает уведомления.
export async function setChatMutedRequest(
  chatId: string,
  muted: boolean,
  minutes?: number,
): Promise<void> {
  if (muted) await api.post(`/chats/${chatId}/mute`, minutes ? { minutes } : {})
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
