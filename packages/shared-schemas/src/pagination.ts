import { z } from 'zod'

// Offset-пагинация для админских таблиц (docs/PROJECT.md §8.3). limit ≤ 100.
export const OffsetPaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

export type OffsetPaginationInput = z.infer<typeof OffsetPaginationSchema>

// Cursor-пагинация для лент контента и сообщений (docs/PROJECT.md §8.3). limit ≤ 50.
// cursor — id последней полученной записи; ответ отдаёт meta.cursor для следующей страницы.
export const CursorPaginationSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
})

export type CursorPaginationInput = z.infer<typeof CursorPaginationSchema>
