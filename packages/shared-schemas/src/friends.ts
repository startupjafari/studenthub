import { z } from 'zod'
import { CursorPaginationSchema } from './pagination.js'

// Схемы «друзей» — единый источник валидации для API и фронта.

// Отправить заявку в друзья пользователю.
export const SendFriendRequestSchema = z.object({ userId: z.string().uuid() }).strict()
export type SendFriendRequestInput = z.infer<typeof SendFriendRequestSchema>

// Список друзей (только принятые) — cursor-пагинация.
export const FriendsListQuerySchema = CursorPaginationSchema
export type FriendsListQueryInput = z.infer<typeof FriendsListQuerySchema>

// Список заявок: входящие (мне) или исходящие (мои).
export const FriendRequestsQuerySchema = CursorPaginationSchema.extend({
  direction: z.enum(['incoming', 'outgoing']).default('incoming'),
})
export type FriendRequestsQueryInput = z.infer<typeof FriendRequestsQuerySchema>

// Статус дружбы относительно смотрящего (отдаётся в профиле /users/:id).
export const FRIENDSHIP_STATUS = [
  'NONE',
  'PENDING_OUTGOING',
  'PENDING_INCOMING',
  'ACCEPTED',
] as const
export type FriendshipStatusValue = (typeof FRIENDSHIP_STATUS)[number]
