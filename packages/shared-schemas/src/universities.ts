import { z } from 'zod'
import { AdminLimitSchema, OffsetPaginationSchema, SortOrderSchema } from './pagination.js'

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

// Колонки таблицы вузов, по которым разрешена сортировка на сервере.
//
// Города в списке нет намеренно: `city` хранит код КАТО, а таблица показывает
// резолвнутое название. Сортировка по коду выстроила бы строки по регионам, а не по
// алфавиту названий — то есть не по тому, что видит глаз. Сортировать же открытую
// страницу на клиенте нельзя: это упорядочит 20 строк из двухсот и соврёт сильнее.
export const UNIVERSITY_SORT_FIELDS = ['name', 'shortName', 'status', 'createdAt'] as const
export const UniversitySortSchema = z.enum(UNIVERSITY_SORT_FIELDS)
export type UniversitySortValue = z.infer<typeof UniversitySortSchema>

// Список вузов для админки платформы (docs/PROJECT.md §6.1).
// sort/order — по всей выборке, а не по открытой странице.
// search — по названию и аббревиатуре, без учёта регистра.
export const UniversityListQuerySchema = OffsetPaginationSchema.extend({
  search: z.string().min(1).max(100).optional(),
  status: UniversityStatusSchema.optional(),
  sort: UniversitySortSchema.optional(),
  order: SortOrderSchema.optional(),
  // Таблица даёт выбрать 20/100/150/200 строк на странице — предел здесь выше общего.
  limit: AdminLimitSchema,
})
export type UniversityListQueryInput = z.infer<typeof UniversityListQuerySchema>
