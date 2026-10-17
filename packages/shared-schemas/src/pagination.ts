import { z } from 'zod'

// Offset-пагинация для админских таблиц (docs/PROJECT.md §8.3). limit ≤ 100.
export const OffsetPaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

export type OffsetPaginationInput = z.infer<typeof OffsetPaginationSchema>

// Размеры страницы админских таблиц: их предлагает селектор в подвале таблицы.
// Верхний предел общей offset-схемы (100) для таких списков поднят до 200 — но только
// там, где выбор размера действительно есть (users, audit), а не во всех списках подряд.
export const ADMIN_PAGE_SIZES = [20, 100, 150, 200] as const
export const AdminLimitSchema = z.coerce.number().int().positive().max(200).default(20)

// Направление сортировки для админских таблиц. Само поле сортировки — enum у каждого
// списка отдельно: сортировать можно только по колонкам, которые таблица показывает,
// произвольное имя поля в orderBy пускать нельзя.
export const SortOrderSchema = z.enum(['asc', 'desc']).default('asc')
export type SortOrderValue = z.infer<typeof SortOrderSchema>

// Cursor-пагинация для лент контента и сообщений (docs/PROJECT.md §8.3). limit ≤ 50.
// cursor — id последней полученной записи; ответ отдаёт meta.cursor для следующей страницы.
export const CursorPaginationSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
})

export type CursorPaginationInput = z.infer<typeof CursorPaginationSchema>

// Cursor-пагинация ПО ЗАПРОСУ — для списков, которые раньше отдавались целиком одним
// массивом (комментарии, опросы автора, участники события). Без `limit` и `cursor` ручка
// отвечает как раньше — так читают уже выпущенные клиенты (iOS, Android, мини-апп). С ними —
// страница: `meta.cursor` — id последней записи страницы (по нему просят следующую),
// `meta.hasNext` — есть ли ещё. limit ≤ 50, как у лент.
export const OptionalCursorPaginationSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
})
export type OptionalCursorPaginationInput = z.infer<typeof OptionalCursorPaginationSchema>

/** Клиент попросил страницу (прислал `limit` или `cursor`), а не прежний список целиком. */
export function isPageRequested(query: OptionalCursorPaginationInput | undefined): boolean {
  return query?.limit !== undefined || query?.cursor !== undefined
}

// Размер страницы, когда пришёл только `cursor`.
export const DEFAULT_PAGE_LIMIT = 20

// Комментарии (посты, статьи, опросы, события). Страница — свежие сверху: `meta.cursor` —
// id самого старого комментария страницы, по нему просят более ранние; `meta.total` —
// сколько комментариев всего (заголовок «N комментариев» не должен зависеть от того,
// сколько страниц догружено). Без параметров — прежний ответ: последние комментарии
// массивом по порядку написания.
export const CommentsQuerySchema = OptionalCursorPaginationSchema
export type CommentsQueryInput = OptionalCursorPaginationInput
