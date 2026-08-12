import { z } from 'zod'

// Глобальный поиск (docs/ACADEMIC_CORE.md, задача 22).
export const SearchQuerySchema = z
  .object({
    q: z.string().min(2).max(100),
  })
  .strict()
export type SearchQueryInput = z.infer<typeof SearchQuerySchema>
