import { z } from 'zod'
import { OffsetPaginationSchema, SortOrderSchema } from './pagination.js'

// Консультации (docs/ACADEMIC_CORE.md, задача 15). Статус — строка (SSOT здесь).
export const CONSULTATION_STATUSES = ['OPEN', 'BOOKED', 'CANCELLED'] as const
export const ConsultationStatusSchema = z.enum(CONSULTATION_STATUSES)
export type ConsultationStatus = z.infer<typeof ConsultationStatusSchema>

const isoDateTime = z.string().datetime({ offset: true })

export const CreateSlotSchema = z
  .object({
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    location: z.string().max(200).optional(),
    isOnline: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.endsAt > v.startsAt, {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  })
export type CreateSlotInput = z.infer<typeof CreateSlotSchema>

export const BookSlotSchema = z
  .object({
    topic: z.string().max(500).optional(),
  })
  .strict()
export type BookSlotInput = z.infer<typeof BookSlotSchema>

export const SlotListQuerySchema = z
  .object({
    teacherId: z.string().min(1).optional(),
  })
  .strict()
export type SlotListQueryInput = z.infer<typeof SlotListQuerySchema>

// ── Мои консультации: таблица с пагинацией и сортировкой на сервере ──────────
//
// Сортировка серверная, а не в браузере: клиент видит одну страницу, и сортировка
// на ней переставляла бы только её — верх списка при этом оставался бы прежним.
//
// Поле сортировки — enum, а не произвольная строка: в `orderBy` уходит только то,
// что таблица показывает колонкой (pagination.ts, к SortOrderSchema).
export const CONSULTATION_SORTS = ['startsAt', 'status', 'student'] as const
export const ConsultationSortSchema = z.enum(CONSULTATION_SORTS)
export type ConsultationSort = z.infer<typeof ConsultationSortSchema>

export const ConsultationMineQuerySchema = OffsetPaginationSchema.extend({
  sort: ConsultationSortSchema.default('startsAt'),
  order: SortOrderSchema.default('asc'),
  /**
   * Только слоты, начинающиеся не раньше этого момента. Нужен дашборду: список
   * отсортирован по возрастанию, и без фильтра его первая страница — самые СТАРЫЕ
   * слоты, то есть прошлогодние. Отдельной сортировки по убыванию для этого мало:
   * «ближайшие» и «последние прошедшие» — разные вопросы.
   */
  from: isoDateTime.optional(),
}).strict()
export type ConsultationMineQueryInput = z.infer<typeof ConsultationMineQuerySchema>
