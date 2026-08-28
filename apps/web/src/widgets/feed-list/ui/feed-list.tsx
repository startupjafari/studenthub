'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Newspaper } from 'lucide-react'
import type { FeedFilterValue } from '@studenthub/shared-schemas'
import { fetchFeed, postKeys, type FeedPage } from '../../../entities/post'
import { Button, EmptyState, Skeleton } from '../../../shared/ui'
import { PostCard } from './post-card'

// Лайтбокс (портал, галерея, видео, свайпы) грузится только при открытии медиа —
// для рендера самой ленты он не нужен и раньше тянулся в First Load JS.
const PostLightbox = dynamic(() => import('./post-lightbox').then((m) => m.PostLightbox), {
  ssr: false,
})

// Фильтр приходит снаружи: на экране «Посты» он живёт в шапке страницы, а на главной
// студента ленты-разделы нет — там всегда «Все».
export function FeedList({ filter = 'ALL' }: { filter?: FeedFilterValue }) {
  const t = useTranslations('Feed')
  const tErr = useTranslations('Errors')
  const tc = useTranslations('Common')
  // Полный просмотр: индекс поста и нужно ли сразу поставить курсор в поле
  // комментария (кнопка «Комментировать» ведёт именно туда — писать можно только там).
  const [open, setOpen] = useState<{ index: number; focusComment: boolean } | null>(null)

  const query = useInfiniteQuery({
    queryKey: postKeys.feed(filter),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      fetchFeed({ limit: 20, cursor: pageParam, filter: filter === 'ALL' ? undefined : filter }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: FeedPage) => (last.hasNext ? last.cursor : undefined),
  })

  const posts = query.data?.pages.flatMap((p) => p.items) ?? []

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-64 w-full rounded-2xl" />
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

  if (posts.length === 0) {
    return (
      <EmptyState
        icon={<Newspaper className="size-6" aria-hidden />}
        title={t('emptyTitle')}
        description={t('emptyText')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {posts.map((post, i) => (
        <PostCard
          key={post.id}
          post={post}
          onOpenMedia={() => setOpen({ index: i, focusComment: false })}
          onOpenComments={() => setOpen({ index: i, focusComment: true })}
        />
      ))}

      {query.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          loading={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
          className="self-center"
        >
          {t('loadMore')}
        </Button>
      )}

      {open !== null && (
        <PostLightbox
          posts={posts}
          index={open.index}
          focusComment={open.focusComment}
          onIndex={(i) => setOpen({ index: i, focusComment: false })}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
