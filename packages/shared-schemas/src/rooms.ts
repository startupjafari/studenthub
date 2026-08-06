import { z } from 'zod'
import { OffsetPaginationSchema } from './pagination.js'

// Аудитории (docs/PROJECT.md §3.1, §6). Принадлежат вузу; используются в расписании (Ф6).

export const CreateRoomSchema = z
  .object({
    name: z.string().min(1).max(100),
    capacity: z.number().int().positive().max(10000).optional(),
    universityId: z.string().min(1),
  })
  .strict()
export type CreateRoomInput = z.infer<typeof CreateRoomSchema>

export const UpdateRoomSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    capacity: z.number().int().positive().max(10000).nullable().optional(),
  })
  .strict()
export type UpdateRoomInput = z.infer<typeof UpdateRoomSchema>

// Список аудиторий: пагинация + опциональный фильтр по вузу (для платформы).
export const RoomListQuerySchema = OffsetPaginationSchema.extend({
  universityId: z.string().min(1).optional(),
})
export type RoomListQueryInput = z.infer<typeof RoomListQuerySchema>
