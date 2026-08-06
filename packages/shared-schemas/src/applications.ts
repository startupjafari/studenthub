import { z } from 'zod'
import { OffsetPaginationSchema } from './pagination.js'

// Заявки в деканат (docs/PROJECT.md §3.2, Ф7). Значения enum дублируют Prisma-enum
// AppType/ApplicationStatus (единый контракт API↔форма без зависимости от @prisma/client).

export const AppTypeSchema = z.enum([
  'CERTIFICATE',
  'MILITARY',
  'UNIVERSAL',
  'ACADEMIC',
  'FINANCIAL',
  'TECHNICAL',
  'OTHER',
])
export type AppTypeValue = z.infer<typeof AppTypeSchema>

export const ApplicationStatusSchema = z.enum([
  'NEW',
  'PROCESSING',
  'CLARIFICATION',
  'APPROVED',
  'REJECTED',
  'READY',
  'CLOSED',
])
export type ApplicationStatusValue = z.infer<typeof ApplicationStatusSchema>

// Создание: тип + тема + текст. studentId/facultyId берутся из JWT/профиля, не из тела (§7).
export const CreateApplicationSchema = z
  .object({
    type: AppTypeSchema,
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(5000),
  })
  .strict()
export type CreateApplicationInput = z.infer<typeof CreateApplicationSchema>

// Смена статуса деканатом: целевой статус + необязательный комментарий (причина/уточнение).
export const TransitionApplicationSchema = z
  .object({
    toStatus: ApplicationStatusSchema,
    comment: z.string().max(2000).optional(),
  })
  .strict()
export type TransitionApplicationInput = z.infer<typeof TransitionApplicationSchema>

// Список: пагинация + фильтры по статусу/типу (очередь декана и список студента).
export const ApplicationListQuerySchema = OffsetPaginationSchema.extend({
  status: ApplicationStatusSchema.optional(),
  type: AppTypeSchema.optional(),
})
export type ApplicationListQueryInput = z.infer<typeof ApplicationListQuerySchema>
