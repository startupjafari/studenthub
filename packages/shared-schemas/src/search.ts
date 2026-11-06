import { z } from 'zod'

// Источники глобального поиска — ключи ответа `GET /search`.
export const SEARCH_SOURCES = [
  'people',
  'courses',
  'assignments',
  'materials',
  'events',
  'chats',
] as const
export type SearchSource = (typeof SEARCH_SOURCES)[number]

// Глобальный поиск (docs/ACADEMIC_CORE.md, задача 22).
export const SearchQuerySchema = z
  .object({
    q: z.string().min(2).max(100),
    // Какие источники искать, через запятую: `types=people` — подсказке упоминаний нужны
    // только люди, и гонять ради них ещё пять запросов незачем. Ответ остаётся той же формы:
    // не запрошенные источники приходят пустыми. Без параметра — все, как раньше.
    types: z
      .string()
      .min(1)
      .transform((v) => [...new Set(v.split(',').map((s) => s.trim()))].filter(Boolean))
      .pipe(z.array(z.enum(SEARCH_SOURCES)).min(1))
      .optional(),
  })
  .strict()
export type SearchQueryInput = z.infer<typeof SearchQuerySchema>
