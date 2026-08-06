import { z } from 'zod'
import { OffsetPaginationSchema } from './pagination.js'

// Создание группы (PLATFORM_ADMIN / UNIVERSITY_ADMIN своего вуза).
export const CreateGroupSchema = z
  .object({
    name: z.string().min(1).max(100),
    year: z.number().int().min(1900).max(2200).optional(),
    facultyId: z.string().min(1),
  })
  .strict()
export type CreateGroupInput = z.infer<typeof CreateGroupSchema>

// Обновление: название и/или год (перенос между факультетами не поддерживается).
export const UpdateGroupSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    year: z.number().int().min(1900).max(2200).optional(),
  })
  .strict()
export type UpdateGroupInput = z.infer<typeof UpdateGroupSchema>

// Назначение старосты: id участника группы либо null (снять).
export const AssignStarostaSchema = z.object({ starostaId: z.string().min(1).nullable() }).strict()
export type AssignStarostaInput = z.infer<typeof AssignStarostaSchema>

// Список групп: пагинация + опциональный фильтр по факультету.
export const GroupListQuerySchema = OffsetPaginationSchema.extend({
  facultyId: z.string().min(1).optional(),
})
export type GroupListQueryInput = z.infer<typeof GroupListQuerySchema>
