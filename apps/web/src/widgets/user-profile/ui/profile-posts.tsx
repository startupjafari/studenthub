'use client'

import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Newspaper } from 'lucide-react'
import { fetchAuthorPosts, postKeys, type FeedPost } from '../../../entities/post'
import { PostGrid } from '../../feed-list'
import { Button, EmptyState, Skeleton } from '../../../shared/ui'
import { PostCreateModal } from './post-create-modal'
import { ContentLayout, FilterGroup, FilterOption, FilterSkeleton } from './filter-sidebar'
import { useRetryOnError } from './use-retry-on-error'

interface Props {
  userId: string
  isOwner: boolean
  // Сигнал «создать пост» из меню «+» в шапке профиля (nonce меняется при каждом вызове).
  openCreate?: number
  onConsumed?: () => void
}

type SortMode = 'new' | 'popular'
type StatusFilter = 'all' | 'PUBLISHED' | 'DRAFT' | 'SCHEDULED'

// Вкладка «Посты»: слева — сортировка и быстрые фильтры, справа — сетка карточек-публикаций.
export function ProfilePosts({ userId, isOwner, openCreate, onConsumed }: Props) {
  const t = useTranslations('Profile')
  const [creating, setCreating] = useState(false)
  const [sort, setSort] = useState<SortMode>('new')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  useEffect(() => {
    if (openCreate === undefined) return
    setCreating(true)
    onConsumed?.()
  }, [openCreate])

  const q = useInfiniteQuery({
    queryKey: postKeys.author(userId),
    queryFn: ({ pageParam }) => fetchAuthorPosts(userId, { limit: 20, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
  })

  const posts = (q.data?.pages ?? []).flatMap((p) => p.items)
  const sorted = useMemo(() => {
    const filtered =
      isOwner && statusFilter !== 'all' ? posts.filter((p) => p.status === statusFilter) : posts
    return sortPosts(filtered, sort)
  }, [posts, sort, statusFilter, isOwner])

  const modal = creating && <PostCreateModal onClose={() => setCreating(false)} />

  // При ошибке — держим скелетон, тост каждые 5 сек и повтор запроса.
  useRetryOnError(q.isError, q.refetch, t('loadRetry'))

  if (q.isLoading || q.isError) {
    return (
      <>
        {modal}
        <ContentLayout sidebar={<FilterSkeleton />}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <article
                key={i}
                className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
              >
                <Skeleton className="aspect-[4/3] w-full rounded-none" />
                <div className="flex flex-col gap-3 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-14" />
                  </div>
                  <div className="flex items-center gap-5 border-t border-border pt-3">
                    <Skeleton className="h-5 w-10 rounded-full" />
                    <Skeleton className="h-5 w-10 rounded-full" />
                    <Skeleton className="size-5 rounded-full" />
                    <Skeleton className="ml-auto h-5 w-10 rounded-full" />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </ContentLayout>
      </>
    )
  }
  if (posts.length === 0) {
    return (
      <>
        {modal}
        <EmptyState
          icon={<Newspaper className="size-6" aria-hidden />}
          title={t('postsEmpty')}
          className="min-h-[calc(100vh_-_20rem)]"
        />
      </>
    )
  }

  const sidebar = (
    <>
      <FilterGroup title={t('sortBy')}>
        <FilterOption active={sort === 'new'} onClick={() => setSort('new')} label={t('sortNew')} />
        <FilterOption
          active={sort === 'popular'}
          onClick={() => setSort('popular')}
          label={t('sortPopular')}
        />
      </FilterGroup>
      {isOwner && (
        <FilterGroup title={t('filterBy')}>
          <FilterOption
            active={statusFilter === 'all'}
            onClick={() => setStatusFilter('all')}
            label={t('filterAll')}
          />
          <FilterOption
            active={statusFilter === 'PUBLISHED'}
            onClick={() => setStatusFilter('PUBLISHED')}
            label={t('filterPublished')}
          />
          <FilterOption
            active={statusFilter === 'DRAFT'}
            onClick={() => setStatusFilter('DRAFT')}
            label={t('filterDrafts')}
          />
          <FilterOption
            active={statusFilter === 'SCHEDULED'}
            onClick={() => setStatusFilter('SCHEDULED')}
            label={t('filterScheduled')}
          />
        </FilterGroup>
      )}
    </>
  )

  return (
    <>
      {modal}
      <ContentLayout sidebar={sidebar}>
        <div className="flex flex-col gap-4">
          <PostGrid posts={sorted} />
          {q.hasNextPage && (
            <Button
              type="button"
              variant="outline"
              className="mx-auto w-fit"
              loading={q.isFetchingNextPage}
              onClick={() => void q.fetchNextPage()}
            >
              {t('loadMorePosts')}
            </Button>
          )}
        </div>
      </ContentLayout>
    </>
  )
}

// Популярность = лайки + комментарии; закреплённые всегда сверху (сохраняем поведение ленты).
function sortPosts(posts: FeedPost[], mode: SortMode): FeedPost[] {
  const score = (p: FeedPost) => p.reactions.length + p._count.comments
  return [...posts].sort((a, b) => {
    const pin = Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt))
    if (pin !== 0) return pin
    if (mode === 'popular') return score(b) - score(a)
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
}
