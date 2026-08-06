import { z } from 'zod'
import { OffsetPaginationSchema } from './pagination.js'

// Создание факультета (PLATFORM_ADMIN — любой вуз; UNIVERSITY_ADMIN — только свой).
export const CreateFacultySchema = z
  .object({
    name: z.string().min(1).max(200),
    universityId: z.string().min(1),
  })
  .strict()
export type CreateFacultyInput = z.infer<typeof CreateFacultySchema>

// Обновление: меняется только название (перенос факультета между вузами не поддерживается).
export const UpdateFacultySchema = z.object({ name: z.string().min(1).max(200) }).strict()
export type UpdateFacultyInput = z.infer<typeof UpdateFacultySchema>

// Список факультетов: пагинация + опциональный фильтр по вузу (для платформы).
export const FacultyListQuerySchema = OffsetPaginationSchema.extend({
  universityId: z.string().min(1).optional(),
})
export type FacultyListQueryInput = z.infer<typeof FacultyListQuerySchema>
