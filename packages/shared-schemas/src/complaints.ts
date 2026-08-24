import { z } from 'zod'
import { AdminLimitSchema, OffsetPaginationSchema, SortOrderSchema } from './pagination.js'

// Жалобы (docs/PROJECT.md §11, Ф11). Enum'ы дублируют Prisma ComplaintTargetType/ComplaintStatus.
export const ComplaintTargetTypeSchema = z.enum(['POST', 'STORY', 'COMMENT', 'MESSAGE', 'USER'])
export type ComplaintTargetTypeValue = z.infer<typeof ComplaintTargetTypeSchema>

export const ComplaintStatusSchema = z.enum(['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'])
export type ComplaintStatusValue = z.infer<typeof ComplaintStatusSchema>

// Приоритет очереди модерации. Дублирует Prisma ComplaintPriority; порядок значений —
// порядок разбора (HIGH первым), на нём же держится ORDER BY priority ASC на сервере.
export const ComplaintPrioritySchema = z.enum(['HIGH', 'MEDIUM', 'LOW'])
export type ComplaintPriorityValue = z.infer<typeof ComplaintPrioritySchema>

/**
 * Приоритет жалобы по категории цели — одно правило для API (пишет в БД при создании) и
 * для UI (объясняет пользователю, откуда приоритет).
 *
 * HIGH — жалоба на человека и на личные сообщения: страдает конкретный человек
 * (травля, угрозы, спам в личку), и без модератора он защититься не может.
 * MEDIUM — публичный контент (пост, история): виден многим, но не направлен на одного
 * человека, и история к тому же исчезает сама.
 * LOW — комментарий: локальная реплика под чужим контентом.
 */
export const COMPLAINT_PRIORITY_BY_TARGET: Record<
  ComplaintTargetTypeValue,
  ComplaintPriorityValue
> = {
  USER: 'HIGH',
  MESSAGE: 'HIGH',
  POST: 'MEDIUM',
  STORY: 'MEDIUM',
  COMMENT: 'LOW',
}

export function complaintPriorityFor(target: ComplaintTargetTypeValue): ComplaintPriorityValue {
  return COMPLAINT_PRIORITY_BY_TARGET[target]
}

export const CreateComplaintSchema = z
  .object({
    targetType: ComplaintTargetTypeSchema,
    targetId: z.string().min(1),
    reason: z.string().min(1).max(2000),
  })
  .strict()
export type CreateComplaintInput = z.infer<typeof CreateComplaintSchema>

// Действие модератора при разрешении жалобы (задача 11.4).
export const ResolveComplaintSchema = z
  .object({
    action: z.enum(['DELETE_CONTENT', 'BLOCK_USER', 'DISMISS']),
    comment: z.string().max(2000).optional(),
  })
  .strict()
export type ResolveComplaintInput = z.infer<typeof ResolveComplaintSchema>

// Колонки таблицы жалоб, по которым разрешена сортировка.
export const COMPLAINT_SORT_FIELDS = ['priority', 'createdAt', 'status', 'targetType'] as const
export const ComplaintSortSchema = z.enum(COMPLAINT_SORT_FIELDS)
export type ComplaintSortValue = z.infer<typeof ComplaintSortSchema>

// Очередь модерации: фильтры по статусу и приоритету, offset-пагинация (20…200),
// сортировка по всей выборке. Порядок по умолчанию — очередь: сначала необработанные,
// внутри — по приоритету, внутри — свежие раньше.
export const ComplaintListQuerySchema = OffsetPaginationSchema.extend({
  status: ComplaintStatusSchema.optional(),
  priority: ComplaintPrioritySchema.optional(),
  sort: ComplaintSortSchema.optional(),
  order: SortOrderSchema.optional(),
  limit: AdminLimitSchema,
})
export type ComplaintListQueryInput = z.infer<typeof ComplaintListQuerySchema>
