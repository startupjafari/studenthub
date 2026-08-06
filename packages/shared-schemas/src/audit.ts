import { z } from 'zod'
import { OffsetPaginationSchema } from './pagination.js'

// Журнал действий (docs/PROJECT.md §11, Ф11.6). Фильтры по действию/пользователю.
export const AuditListQuerySchema = OffsetPaginationSchema.extend({
  action: z.string().min(1).max(100).optional(),
  userId: z.string().min(1).optional(),
})
export type AuditListQueryInput = z.infer<typeof AuditListQuerySchema>
