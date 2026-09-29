'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchPost, postKeys, type FeedPost } from '../../../entities/post'

export type RepostSource =
  | { kind: 'plain' }
  | { kind: 'loading' }
  /** Исходный пост загружен — показываем его, а не репост. */
  | { kind: 'ready'; source: FeedPost }
  /** Исходник не виден зрителю или удалён — остаётся репост с цитатой. */
  | { kind: 'unavailable' }

/**
 * Репост как в Instagram: на экране — сам исходный пост (его медиа, лайки, комментарии),
 * а репост — только пометка «Репост от …» над ним и заметка репостнувшего.
 *
 * В ответе ленты у репоста есть лишь текст исходника, без медиа и счётчиков, поэтому
 * исходный пост догружается отдельным `GET /posts/:id` — в тот же кэш, что и страница
 * поста: плитка профиля, карточка ленты и полный просмотр делят один запрос.
 *
 * Видимость решает сервер: исходник, которого зрителю видеть нельзя, отвечает
 * NOT_FOUND, и тогда показывается прежняя цитата — не раскрывая, есть ли он вообще.
 */
export function useRepostSource(post: FeedPost | undefined): RepostSource {
  const originalId = post?.original?.id ?? null
  const query = useQuery({
    queryKey: postKeys.detail(originalId ?? ''),
    queryFn: () => fetchPost(originalId as string),
    enabled: originalId !== null,
    // Недоступный пост повторными запросами доступным не станет.
    retry: false,
    staleTime: 60_000,
  })

  if (originalId === null) return { kind: 'plain' }
  if (query.data) return { kind: 'ready', source: query.data }
  if (query.isError) return { kind: 'unavailable' }
  return { kind: 'loading' }
}
