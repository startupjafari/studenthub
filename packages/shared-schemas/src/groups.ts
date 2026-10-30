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
// Год необязателен и при создании, поэтому его можно и стереть: `null` — «год не указан».
export const UpdateGroupSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    year: z.number().int().min(1900).max(2200).nullable().optional(),
  })
  .strict()
export type UpdateGroupInput = z.infer<typeof UpdateGroupSchema>

// Назначение старосты: id участника группы либо null (снять).
export const AssignStarostaSchema = z.object({ starostaId: z.string().min(1).nullable() }).strict()
export type AssignStarostaInput = z.infer<typeof AssignStarostaSchema>

// Список групп: пагинация + опциональный фильтр по факультету.
// search — подстрока названия без учёта регистра: пикеры ищут группу на сервере, а не
// выгружают все страницы (у большого вуза групп больше, чем помещается в одну).
export const GroupListQuerySchema = OffsetPaginationSchema.extend({
  facultyId: z.string().min(1).optional(),
  search: z.string().trim().min(1).max(100).optional(),
})
export type GroupListQueryInput = z.infer<typeof GroupListQuerySchema>
