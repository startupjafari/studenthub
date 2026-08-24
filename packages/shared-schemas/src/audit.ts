import { z } from 'zod'
import { AdminLimitSchema, OffsetPaginationSchema, SortOrderSchema } from './pagination.js'

// Колонки журнала, по которым разрешена сортировка.
export const AUDIT_SORT_FIELDS = ['createdAt', 'action', 'entity', 'userId'] as const
export const AuditSortSchema = z.enum(AUDIT_SORT_FIELDS)
export type AuditSortValue = z.infer<typeof AuditSortSchema>

// Журнал действий (docs/PROJECT.md §11, Ф11.6). Фильтры по действию/пользователю,
// sort/order — сортировка по всей выборке (по умолчанию createdAt desc).
export const AuditListQuerySchema = OffsetPaginationSchema.extend({
  action: z.string().min(1).max(100).optional(),
  userId: z.string().min(1).optional(),
  sort: AuditSortSchema.optional(),
  order: SortOrderSchema.optional(),
  // Таблица даёт выбрать 20/100/150/200 строк на странице — предел здесь выше общего.
  limit: AdminLimitSchema,
})
export type AuditListQueryInput = z.infer<typeof AuditListQuerySchema>
