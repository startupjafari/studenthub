import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { postKeys, type FeedPage } from '../api/post-api'
import type { FeedPost, PostAudienceValue, PostReactionSummary } from './types'

// Данные сигналов живой ленты (docs/PROJECT.md §9.2d). Только вид изменения и числа — сам
// пост клиент перечитывает своим запросом.

/** `feed.post.created`: кто и кому опубликовал. */
export interface FeedPostCreatedSignal {
  audience: PostAudienceValue
  authorId: string
}

/** `feed.post.changed`: правка, удаление или новые счётчики (без признака «моя»). */
export type FeedPostChangedSignal =
  | { kind: 'edited' | 'deleted' }
  | {
      kind: 'counters'
      reactions: Array<{ emoji: string; count: number }>
      comments: number
    }

/** `post.comments.changed`: сколько комментариев под постом теперь. */
export interface PostCommentsChangedSignal {
  count: number
}

/**
 * Сводка реакций после сигнала «счётчики»: числа — с сервера, признак «моя» — свой. Своя
 * реакция, которой в пришедших числах ещё нет (сигнал посчитан до лайка, а пришёл после
 * оптимистичного обновления), держится единицей: иначе сердечко гасло бы под пальцем.
 */
export function withServerTotals(
  current: readonly PostReactionSummary[],
  totals: ReadonlyArray<{ emoji: string; count: number }>,
): PostReactionSummary[] {
  const mine = new Set(current.filter((item) => item.mine).map((item) => item.emoji))
  const next = totals
    .filter((item) => item.count > 0 || mine.has(item.emoji))
    .map((item) => ({
      emoji: item.emoji,
      count: mine.has(item.emoji) ? Math.max(1, item.count) : item.count,
      mine: mine.has(item.emoji),
    }))
  for (const emoji of mine) {
    if (!next.some((item) => item.emoji === emoji)) next.push({ emoji, count: 1, mine: true })
  }
  return next
}

// Обсуждение и ссылки на медиа лежат под тем же ['posts', …] — там не посты.
const isPostList = (q: { queryKey: readonly unknown[] }) =>
  q.queryKey[2] !== 'comments' && q.queryKey[1] !== 'media'

/** Есть ли пост хоть в одной закэшированной выдаче — иначе перечитывать его незачем. */
export function isPostCached(qc: QueryClient, postId: string): boolean {
  return qc
    .getQueriesData<unknown>({ queryKey: postKeys.all, predicate: isPostList })
    .some(([, data]) => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return false
      if ('pages' in data) {
        return (data as InfiniteData<FeedPage>).pages.some((pg) =>
          pg.items.some((p) => p.id === postId),
        )
      }
      return 'id' in data && (data as FeedPost).id === postId
    })
}

/**
 * Перечитать ленту с начала — по нажатию «N новых публикаций». Сначала она укорачивается до
 * первой страницы: читающий всё равно поднимается наверх, а перечитывать ради этого все
 * догруженные страницы подряд — лишние запросы и задержка перед появлением новых постов.
 */
export async function reloadFeedFromTop(
  qc: QueryClient,
  queryKey: readonly unknown[],
): Promise<void> {
  qc.setQueryData<InfiniteData<FeedPage>>(queryKey, (data) =>
    data && data.pages.length > 1
      ? { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) }
      : data,
  )
  await qc.refetchQueries({ queryKey, exact: true })
}

/**
 * Убрать пост из закэшированных лент (удалён автором или снят модерацией). Страницу поста
 * не трогаем — её перечитывает инвалидация: сервер ответит «не найдено», и экран покажет
 * «публикация недоступна».
 */
export function removeCachedPost(qc: QueryClient, postId: string): void {
  qc.setQueriesData<unknown>({ queryKey: postKeys.all, predicate: isPostList }, (data: unknown) => {
    if (!data || typeof data !== 'object' || !('pages' in data)) return data
    const feed = data as InfiniteData<FeedPage>
    if (!feed.pages.some((pg) => pg.items.some((p) => p.id === postId))) return data
    return {
      ...feed,
      pages: feed.pages.map((pg, i) => ({
        ...pg,
        items: pg.items.filter((p) => p.id !== postId),
        // Общее число постов автора (бейдж вкладки профиля) живёт в первой странице.
        ...(i === 0 && pg.total !== undefined ? { total: Math.max(0, pg.total - 1) } : {}),
      })),
    }
  })
}
