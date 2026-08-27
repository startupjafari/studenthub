import type { Role } from '@studenthub/shared-types'
import type { FriendshipStatusValue } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'

// Карточка пользователя в списках друзей/заявок (то, что отдаёт бэкенд).
export interface FriendUser {
  id: string
  firstName: string
  lastName: string
  middleName: string | null
  avatarUrl: string | null
  avatarThumbUrl: string | null
  role: Role
  headline: string | null
  universityId: string | null
  facultyId: string | null
  groupId: string | null
}

export interface FriendItem {
  friendshipId: string
  since: string | null
  user: FriendUser
}

export interface FriendRequestItem {
  friendshipId: string
  createdAt: string
  user: FriendUser
}

export interface FriendCount {
  friends: number
  incomingRequests: number
}

export interface FriendshipStatusResult {
  status: FriendshipStatusValue
  friendshipId?: string
}

export type RequestDirection = 'incoming' | 'outgoing'

// `limit` — часть ключа: превью в колонке (6 карточек) и полный список в окне — это
// два разных запроса, и делить кэш им нельзя, иначе окно покажет обрезанную выборку.
export const friendKeys = {
  all: ['friends'] as const,
  list: (limit?: number) => ['friends', 'list', limit ?? 'all'] as const,
  requests: (direction: RequestDirection, limit?: number) =>
    ['friends', 'requests', direction, limit ?? 'all'] as const,
  count: () => ['friends', 'count'] as const,
  status: (userId: string) => ['friends', 'status', userId] as const,
}

// Бэкенд отдаёт список как Paginated — интерцептор разворачивает конверт, и здесь
// приходит уже сам массив (shared/api/instance.ts). Курсор превью не нужен: за полным
// списком идут в окно «Друзья».
export async function fetchFriends(limit?: number): Promise<FriendItem[]> {
  const { data } = await api.get<FriendItem[]>('/friends', {
    params: limit ? { limit } : undefined,
  })
  return data
}

export async function fetchFriendRequests(
  direction: RequestDirection,
  limit?: number,
): Promise<FriendRequestItem[]> {
  const { data } = await api.get<FriendRequestItem[]>('/friends/requests', {
    params: { direction, ...(limit ? { limit } : {}) },
  })
  return data
}

export async function fetchFriendCount(): Promise<FriendCount> {
  const { data } = await api.get<FriendCount>('/friends/count')
  return data
}

export async function fetchFriendshipStatus(userId: string): Promise<FriendshipStatusResult> {
  const { data } = await api.get<FriendshipStatusResult>(`/friends/status/${userId}`)
  return data
}

export async function sendFriendRequest(userId: string): Promise<void> {
  await api.post('/friends/requests', { userId })
}

export async function acceptFriendRequest(friendshipId: string): Promise<void> {
  await api.post(`/friends/requests/${friendshipId}/accept`)
}

export async function removeFriendship(friendshipId: string): Promise<void> {
  await api.delete(`/friends/${friendshipId}`)
}
