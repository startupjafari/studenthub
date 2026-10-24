import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { postKeys, type FeedPage } from '../api/post-api'
import type { FeedPost } from './types'

/**
 * Правка одного поста во всех закэшированных выдачах (лента, профиль, полка, страница
 * поста) — без перезапроса. Пост в кэше — единственный источник его состояния у зрителя
 * (FRONTEND_RULES §5.5): карточка в ленте и полный просмотр читают его оттуда, поэтому
 * закладка или лайк, поставленные в одном месте, видны и в другом. Раньше каждый держал
 * своё локальное состояние, и «Сохранить» в полном просмотре снимало только что
 * поставленную в ленте закладку — переключатель на сервере срабатывал второй раз.
 */
export function patchCachedPost(
  qc: QueryClient,
  postId: string,
  edit: (post: FeedPost) => FeedPost,
): void {
  const apply = (p: FeedPost): FeedPost => (p.id === postId ? edit(p) : p)
  // Обсуждение лежит под тем же ['posts', …] и тоже бесконечный список — его не трогаем:
  // там не посты, а комментарии.
  const notComments = (q: { queryKey: readonly unknown[] }) => q.queryKey[2] !== 'comments'
  qc.setQueriesData<unknown>({ queryKey: postKeys.all, predicate: notComments }, (data) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data
    if ('pages' in data) {
      const feed = data as InfiniteData<FeedPage>
      return { ...feed, pages: feed.pages.map((pg) => ({ ...pg, items: pg.items.map(apply) })) }
    }
    if ('id' in data && '_count' in data) return apply(data as FeedPost)
    return data
  })
}
