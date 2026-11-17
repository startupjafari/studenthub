import type {
  AvatarPhotoDto,
  ChatJoinSettingsInput,
  ChatPermissions,
  UpdateChatPermissionsInput,
} from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'

// Группы как в Telegram (docs/PROJECT.md §8.3): «Разрешения», тип группы, заявки на
// вступление, исключённые и история фото. Отдельно от chat-api.ts — тот и так длинный.

export const groupKeys = {
  joinRequests: (chatId: string) => ['chats', chatId, 'join-requests'] as const,
  removed: (chatId: string) => ['chats', chatId, 'removed'] as const,
  // История фото: группы — по id чата, человека — по id пользователя.
  chatPhotos: (chatId: string) => ['chats', chatId, 'photos'] as const,
  userPhotos: (userId: string) => ['user', 'photos', userId] as const,
}

/** Настройки группы после изменения (тело ответа и события `chat:permissions`). */
export interface ChatGroupSettings {
  chatId: string
  permissions: ChatPermissions
  joinByLink: boolean
  joinApproval: boolean
}

/** Человек в списке заявок или исключённых. */
export interface GroupPersonRow {
  id: string
  firstName: string
  lastName: string
  avatarUrl: string | null
}

export interface JoinRequestRow extends GroupPersonRow {
  requestedAt: string
}

export interface RemovedMemberRow extends GroupPersonRow {
  removedAt: string
  /** Кто исключил; null — его аккаунт удалён. */
  removedBy: GroupPersonRow | null
}

export type AvatarPhoto = AvatarPhotoDto

export async function updateChatPermissionsRequest(
  chatId: string,
  patch: UpdateChatPermissionsInput,
): Promise<ChatGroupSettings> {
  const { data } = await api.patch<ChatGroupSettings>(
    `/chats/${encodeURIComponent(chatId)}/permissions`,
    patch,
  )
  return data
}

export async function updateChatJoinSettingsRequest(
  chatId: string,
  patch: ChatJoinSettingsInput,
): Promise<ChatGroupSettings> {
  const { data } = await api.patch<ChatGroupSettings>(
    `/chats/${encodeURIComponent(chatId)}/join-settings`,
    patch,
  )
  return data
}

export async function fetchJoinRequests(chatId: string): Promise<JoinRequestRow[]> {
  const { data } = await api.get<JoinRequestRow[]>(
    `/chats/${encodeURIComponent(chatId)}/join-requests`,
  )
  return data
}

export async function approveJoinRequest(chatId: string, userId: string): Promise<void> {
  await api.post(
    `/chats/${encodeURIComponent(chatId)}/join-requests/${encodeURIComponent(userId)}/approve`,
  )
}

export async function declineJoinRequest(chatId: string, userId: string): Promise<void> {
  await api.delete(
    `/chats/${encodeURIComponent(chatId)}/join-requests/${encodeURIComponent(userId)}`,
  )
}

export async function fetchRemovedMembers(chatId: string): Promise<RemovedMemberRow[]> {
  const { data } = await api.get<RemovedMemberRow[]>(`/chats/${encodeURIComponent(chatId)}/removed`)
  return data
}

export async function fetchChatPhotos(chatId: string): Promise<AvatarPhoto[]> {
  const { data } = await api.get<AvatarPhoto[]>(`/chats/${encodeURIComponent(chatId)}/avatars`)
  return data
}

export async function deleteChatPhotoRequest(chatId: string, photoId: string): Promise<void> {
  await api.delete(`/chats/${encodeURIComponent(chatId)}/avatars/${encodeURIComponent(photoId)}`)
}

export async function fetchUserPhotos(userId: string): Promise<AvatarPhoto[]> {
  const { data } = await api.get<AvatarPhoto[]>(`/users/${encodeURIComponent(userId)}/avatars`)
  return data
}

export async function deleteMyPhotoRequest(photoId: string): Promise<void> {
  await api.delete(`/users/me/avatars/${encodeURIComponent(photoId)}`)
}
