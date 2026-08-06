import type { ApiMeta } from '@studenthub/shared-types'

// Обёртка для списочных ответов: сервис возвращает Paginated, ResponseInterceptor
// раскладывает её в { success, data, meta }. Для обычных ответов обёртка не нужна.
export class Paginated<T> {
  constructor(
    readonly items: T[],
    readonly meta: ApiMeta,
  ) {}
}
