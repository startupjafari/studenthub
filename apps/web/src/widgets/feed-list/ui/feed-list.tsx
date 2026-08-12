'use client'

import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Newspaper } from 'lucide-react'
import type { FeedFilterValue } from '@studenthub/shared-schemas'
import { fetchFeed, postKeys, type FeedPage } from '../../../entities/post'
import { Button, EmptyState, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib'
import { PostGrid } from './post-grid'

// Табы ленты (Ф8+): фильтр уходит на сервер и всегда пересекается с видимостью зрителя.
const FILTERS: readonly FeedFilterValue[] = ['ALL', 'GROUP', 'UNIVERSITY', 'TEACHERS', 'IMPORTANT']
const FILTER_LABEL: Record<FeedFilterValue, string> = {
  ALL: 'filterAll',
  GROUP: 'filterGroup',
  UNIVERSITY: 'filterUniversity',
  TEACHERS: 'filterTeachers',
  IMPORTANT: 'filterImportant',
}

export function FeedList() {
  const t = useTranslations('Feed')
  const tErr = useTranslations('Errors')
  const tc = useTranslations('Common')
  const [filter, setFilter] = useState<FeedFilterValue>('ALL')

  const query = useInfiniteQuery({
    queryKey: postKeys.feed(filter),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      fetchFeed({ limit: 20, cursor: pageParam, filter: filter === 'ALL' ? undefined : filter }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: FeedPage) => (last.hasNext ? last.cursor : undefined),
  })

  const posts = query.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1 rounded-xl border border-border/60 bg-card p-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              filter === f
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {t(FILTER_LABEL[f])}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="grid grid-cols-3 gap-1 sm:gap-2">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-none" />
          ))}
        </div>
      ) : query.isError ? (
        <EmptyState
          icon={<Newspaper className="size-6" aria-hidden />}
          title={tErr('INTERNAL_ERROR')}
          action={
            <Button variant="outline" onClick={() => query.refetch()}>
              {tc('retry')}
            </Button>
          }
          className="min-h-[240px]"
        />
      ) : posts.length === 0 ? (
        <EmptyState
          icon={<Newspaper className="size-6" aria-hidden />}
          title={t('emptyTitle')}
          description={t('emptyText')}
          className="min-h-[240px]"
        />
      ) : (
        <>
          <PostGrid posts={posts} />
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
        </>
      )}
    </div>
  )
}
