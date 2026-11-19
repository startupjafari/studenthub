'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Newspaper } from 'lucide-react'
import type { FeedFilterValue } from '@studenthub/shared-schemas'
import {
  fetchFeed,
  postKeys,
  reloadFeedFromTop,
  useNewPostsCount,
  usePostLiveCache,
  type FeedPage,
  type FeedPostCreatedSignal,
} from '../../../entities/post'
import { Button, EmptyState, NewItemsPill, Skeleton } from '../../../shared/ui'
import { useFreshIds, useInfiniteScroll } from '../../../shared/lib'
import { scrollContainerToTop } from '../lib/scroll-to-top'
import { PostCard } from './post-card'

// Лайтбокс (портал, галерея, видео, свайпы) грузится только при открытии медиа —
// для рендера самой ленты он не нужен и раньше тянулся в First Load JS.
const PostLightbox = dynamic(() => import('./post-lightbox').then((m) => m.PostLightbox), {
  ssr: false,
})

/**
 * Попадёт ли новый пост во вкладку ленты — по аудитории из сигнала. «Преподаватели» (по роли
 * автора), «Важное», «Сохранённое» и модерацию по сигналу не определить — там плашки нет.
 */
function matchesFilter(filter: FeedFilterValue): ((s: FeedPostCreatedSignal) => boolean) | null {
  switch (filter) {
    case 'ALL':
      return () => true
    case 'GROUP':
      return (s) => s.audience === 'GROUP'
    case 'UNIVERSITY':
      return (s) => s.audience === 'UNIVERSITY'
    default:
      return null
  }
}

// Фильтр приходит снаружи: на экране «Посты» он живёт в шапке страницы, а на главной
// студента ленты-разделы нет — там всегда «Все».
export function FeedList({ filter = 'ALL' }: { filter?: FeedFilterValue }) {
  const t = useTranslations('Feed')
  const tErr = useTranslations('Errors')
  const tc = useTranslations('Common')
  // Полный просмотр: какой пост и нужно ли сразу поставить курсор в поле комментария
  // (кнопка «Комментировать» ведёт именно туда — писать можно только там). Пост — по id, а
  // не по номеру: живая лента убирает удалённые посты, и номер открытого съехал бы на соседа.
  const [open, setOpen] = useState<{
    id: string
    focusComment: boolean
    media?: number
  } | null>(null)
  const qc = useQueryClient()
  const topRef = useRef<HTMLDivElement>(null)

  // Счётчики, правки и удаления чужих постов — правкой кэша на месте (§9.2d).
  usePostLiveCache()
  const match = matchesFilter(filter)
  const fresh = useNewPostsCount({ match: match ?? undefined, enabled: match !== null })
  const resetFresh = fresh.reset
  // Другая вкладка ленты — свой счёт новых: прежний к ней не относится.
  useEffect(() => {
    resetFresh()
  }, [filter, resetFresh])

  const query = useInfiniteQuery({
    queryKey: postKeys.feed(filter),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      fetchFeed({ limit: 20, cursor: pageParam, filter: filter === 'ALL' ? undefined : filter }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: FeedPage) => (last.hasNext ? last.cursor : undefined),
  })

  const posts = query.data?.pages.flatMap((p) => p.items) ?? []
  // Подсветка — только у постов, появившихся на первой странице после «N новых»: догрузка
  // следующих страниц — не новость. Метка-точка отсчёта нужна пустой ленте: иначе первый
  // пришедший пост стал бы точкой отсчёта и не подсветился. Ключ из id — чтобы правка
  // счётчиков в кэше (новый массив с теми же постами) не перезапускала отсчёт подсветки.
  const loaded = query.data !== undefined
  const firstPageKey = (query.data?.pages[0]?.items ?? []).map((p) => p.id).join('|')
  const firstPageIds = useMemo(
    () => (loaded ? ['feed', ...firstPageKey.split('|').filter(Boolean)] : undefined),
    [firstPageKey, loaded],
  )
  const freshIds = useFreshIds(firstPageIds)
  const openIndex = open ? posts.findIndex((p) => p.id === open.id) : -1
  // Открытый пост пропал из ленты (удалён) — окно закрыто насовсем, а не до его возвращения.
  const openLost = open !== null && openIndex < 0
  useEffect(() => {
    if (openLost) setOpen(null)
  }, [openLost])

  // «N новых»: укоротить ленту до первой страницы, перечитать и подняться к началу.
  function showNew(): void {
    fresh.reset()
    scrollContainerToTop(topRef.current)
    void reloadFeedFromTop(qc, postKeys.feed(filter))
  }

  // Кнопки «показать ещё» нет: лента догружается сама, когда читатель доходит до
  // конца. Хук объявлен до ранних выходов — порядок хуков в рендере обязан совпадать.
  const loadMoreRef = useInfiniteScroll<HTMLDivElement>({
    hasNext: query.hasNextPage,
    loading: query.isFetchingNextPage,
    onLoad: () => void query.fetchNextPage(),
  })

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} fill className="min-h-64 rounded-xl" />
        ))}
      </div>
    )
  }

  if (query.isError) {
    return (
      <EmptyState
        icon={<Newspaper className="size-6" aria-hidden />}
        title={tErr('INTERNAL_ERROR')}
        action={
          <Button variant="outline" onClick={() => query.refetch()}>
            {tc('retry')}
          </Button>
        }
      />
    )
  }

  const pill = (
    <NewItemsPill
      count={fresh.count}
      label={t('newPosts', { count: fresh.count })}
      onClick={showNew}
      // Плашка висит над первой карточкой и не занимает места: появление не сдвигает ленту.
      className="-mb-4 h-0"
    />
  )

  if (posts.length === 0) {
    return (
      <div ref={topRef} className="flex flex-col gap-4">
        {pill}
        <EmptyState
          icon={<Newspaper className="size-6" aria-hidden />}
          title={t('emptyTitle')}
          description={t('emptyText')}
        />
      </div>
    )
  }

  return (
    <div ref={topRef} className="flex flex-col gap-4">
      {pill}
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          className={freshIds.has(post.id) ? 'sh-live-in' : undefined}
          onOpenMedia={(media) => setOpen({ id: post.id, focusComment: false, media })}
          onOpenComments={() => setOpen({ id: post.id, focusComment: true })}
        />
      ))}

      {/* Маячок подгрузки. Пока следующая страница есть — держим на его месте
          заготовку карточки: она и сообщает, что лента не кончилась, и не даёт
          полосе прокрутки дёрнуться в момент, когда посты придут. */}
      {query.hasNextPage && (
        <div ref={loadMoreRef} aria-hidden>
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      )}

      {/* Открытый пост удалили — окно закрывается вместе с ним, а не перескакивает. */}
      {open !== null && openIndex >= 0 && (
        <PostLightbox
          posts={posts}
          index={openIndex}
          focusComment={open.focusComment}
          initialMedia={open.media}
          onIndex={(i) => {
            const next = posts[i]
            if (next) setOpen({ id: next.id, focusComment: false })
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
