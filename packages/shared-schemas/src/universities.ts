import { z } from 'zod'

// Статус вуза (docs/PROJECT.md §6.1 enum UniversityStatus).
export const UniversityStatusSchema = z.enum(['PENDING', 'ACTIVE', 'BLOCKED'])
export type UniversityStatusValue = z.infer<typeof UniversityStatusSchema>

// Создание вуза (только PLATFORM_ADMIN). Статус при создании — по умолчанию PENDING,
// в теле не принимается; активация — через PATCH /:id/status.
export const CreateUniversitySchema = z
  .object({
    name: z.string().min(1).max(200),
    shortName: z.string().min(1).max(50).optional(),
    country: z.string().min(1).max(100).optional(),
    city: z.string().min(1).max(100).optional(),
    timezone: z.string().min(1).max(64).optional(),
  })
  .strict()
export type CreateUniversityInput = z.infer<typeof CreateUniversitySchema>

export const UpdateUniversitySchema = CreateUniversitySchema.partial()
export type UpdateUniversityInput = z.infer<typeof UpdateUniversitySchema>

export const UpdateUniversityStatusSchema = z.object({ status: UniversityStatusSchema }).strict()
export type UpdateUniversityStatusInput = z.infer<typeof UpdateUniversityStatusSchema>
