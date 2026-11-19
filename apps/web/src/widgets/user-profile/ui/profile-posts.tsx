'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  infiniteQueryOptions,
  keepPreviousData,
  useInfiniteQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Newspaper } from 'lucide-react'
import type { AuthorFeedSort, PostStatusValue } from '@studenthub/shared-schemas'
import {
  fetchAuthorPosts,
  fetchCompanyPosts,
  fetchUniversityPagePosts,
  postKeys,
  reloadFeedFromTop,
  useNewPostsCount,
  usePostLiveCache,
} from '../../../entities/post'
import type { ContentOwner } from '../../../entities/profile-content'
import { PostGrid, scrollContainerToTop } from '../../feed-list'
import { EmptyState, MosaicGrid, MosaicTile, NewItemsPill, Skeleton } from '../../../shared/ui'
import { useFreshIds, useInfiniteScroll } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { PostCreateModal } from './post-create-modal'
import { ContentLayout, FilterGroup, FilterOption, FilterSkeleton } from './filter-sidebar'
import { useRetryOnError } from './use-retry-on-error'
import { LoadFailed } from './load-failed'
import { useContentOwner } from '../lib/content-owner'

interface Props {
  userId: string
  isOwner: boolean
  // Сигнал «создать пост» из меню «+» в шапке профиля (nonce меняется при каждом вызове).
  openCreate?: number
  onConsumed?: () => void
}

type StatusFilter = 'all' | PostStatusValue

const PAGE_SIZE = 20

/**
 * Запрос вкладки «Посты». Порядок и фильтр статуса считает сервер (sort/status в ленте с
 * authorId): раньше они применялись к уже загруженным страницам, и свежий пост, лежащий
 * на третьей странице серверного порядка, всплывал наверх только после её догрузки —
 * мозаика переставлялась с каждой подгрузкой.
 *
 * Вид по умолчанию («новые», все статусы) живёт под общим ключом автора: его же читает
 * бейдж вкладки (ProfileTabs), и первая страница грузится один раз на оба места.
 */
export function authorPostsQuery(
  owner: ContentOwner,
  sort: AuthorFeedSort = 'new',
  status: StatusFilter = 'all',
) {
  const isDefault = sort === 'new' && status === 'all'
  // Страница организации — её посты, личный профиль — посты автора.
  const base =
    owner.kind === 'company'
      ? postKeys.company(owner.id)
      : owner.kind === 'university'
        ? postKeys.universityPage(owner.id)
        : postKeys.author(owner.id)
  const fetchPage =
    owner.kind === 'company'
      ? fetchCompanyPosts
      : owner.kind === 'university'
        ? fetchUniversityPagePosts
        : fetchAuthorPosts
  return infiniteQueryOptions({
    queryKey: isDefault ? base : [...base, sort, status],
    queryFn: ({ pageParam }) =>
      fetchPage(owner.id, {
        limit: PAGE_SIZE,
        cursor: pageParam,
        sort,
        ...(status !== 'all' ? { status } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
  })
}

// Вкладка «Посты»: слева — сортировка и быстрые фильтры, справа — мозаика публикаций.
export function ProfilePosts({ userId, isOwner, openCreate, onConsumed }: Props) {
  const t = useTranslations('Profile')
  const tFeed = useTranslations('Feed')
  const [creating, setCreating] = useState(false)
  const [sort, setSort] = useState<AuthorFeedSort>('new')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  // Черновики и отложенные — только на своей вкладке; в чужом профиле фильтра нет.
  const status = isOwner ? statusFilter : 'all'
  const owner = useContentOwner(userId)
  const qc = useQueryClient()
  const gridRef = useRef<HTMLDivElement>(null)
  const isDefaultView = sort === 'new' && status === 'all'

  // Счётчики, правки и удаления постов на вкладке — правкой кэша на месте (§9.2d).
  usePostLiveCache()
  // «N новых» — у чужого личного профиля в виде по умолчанию: пост автора, вышедший, пока
  // профиль открыт. Свой профиль обновляется сам после публикации; у страниц организаций
  // автор поста — сотрудник, и сигнал с профилем не сопоставить.
  const fresh = useNewPostsCount({
    match: (signal) => signal.authorId === owner.id,
    enabled: owner.kind === 'user' && !isOwner && isDefaultView,
  })

  useEffect(() => {
    if (openCreate === undefined) return
    setCreating(true)
    onConsumed?.()
  }, [openCreate])

  const q = useInfiniteQuery({
    ...authorPostsQuery(owner, sort, status),
    // При смене сортировки или фильтра мозаика остаётся на месте, пока не придёт новая
    // выдача, — без мигания скелетоном всей вкладки вместе с боковой панелью.
    placeholderData: keepPreviousData,
  })

  const posts = (q.data?.pages ?? []).flatMap((p) => p.items)
  // Подсветка пришедших постов — по первой странице вида по умолчанию: смена сортировки и
  // догрузка страниц — не новость. Метка-точка отсчёта — для пустой вкладки.
  const defaultLoaded = isDefaultView && q.data !== undefined && !q.isPlaceholderData
  const firstPageKey = defaultLoaded
    ? (q.data?.pages[0]?.items ?? []).map((p) => p.id).join('|')
    : ''
  const firstPageIds = useMemo(
    () => (defaultLoaded ? ['grid', ...firstPageKey.split('|').filter(Boolean)] : undefined),
    [firstPageKey, defaultLoaded],
  )
  const freshIds = useFreshIds(firstPageIds)

  // «N новых»: перечитать вкладку с начала и подняться к ней.
  function showNew(): void {
    fresh.reset()
    scrollContainerToTop(gridRef.current)
    void reloadFeedFromTop(qc, authorPostsQuery(owner).queryKey)
  }

  // Следующая страница подгружается сама, когда низ мозаики подходит к экрану; пока она в
  // пути, её места заняты скелетонами (сколько осталось, но не больше страницы).
  // Ошибка — один тост и повторы с растущей паузой; не помогло — ошибка на месте вкладки.
  const { failed, retry } = useRetryOnError(q, t('loadRetry'))
  // Пока запрос в ошибке, маячок не догружает: иначе на каждом «загрузка кончилась» он
  // срабатывал бы снова и долбил сервер без паузы. Повторы ведёт useRetryOnError.
  const loadMoreRef = useInfiniteScroll<HTMLDivElement>({
    hasNext: !!q.hasNextPage && !q.isError,
    loading: q.isFetchingNextPage,
    onLoad: () => void q.fetchNextPage(),
  })
  const total = q.data?.pages[0]?.total
  // Хотя бы один скелетон, пока есть следующая страница: на нём висит маячок подгрузки.
  const pending =
    q.hasNextPage && !failed
      ? Math.max(1, Math.min(PAGE_SIZE, total !== undefined ? total - posts.length : PAGE_SIZE))
      : 0

  const modal = creating && <PostCreateModal onClose={() => setCreating(false)} />

  if (failed && !q.data) {
    return (
      <>
        {modal}
        <LoadFailed onRetry={retry} busy={q.isFetching} />
      </>
    )
  }
  if (!q.data) {
    return (
      <>
        {modal}
        <ContentLayout sidebar={<FilterSkeleton />}>
          <MosaicGrid aria-hidden>
            {Array.from({ length: 12 }).map((_, i) => (
              <MosaicTile key={i}>
                <Skeleton className="size-full rounded-none" />
              </MosaicTile>
            ))}
          </MosaicGrid>
        </ContentLayout>
      </>
    )
  }
  // Пусто в виде по умолчанию — постов у автора нет вовсе; пусто под фильтром — сообщение
  // рядом с панелью фильтров, чтобы фильтр можно было снять.
  const filtered = sort !== 'new' || status !== 'all'
  if (posts.length === 0 && !filtered) {
    return (
      <>
        {modal}
        <EmptyState
          icon={<Newspaper className="size-6" aria-hidden />}
          title={t('postsEmpty')}
          className="min-h-[calc(100dvh_-_20rem)]"
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
        {posts.length === 0 ? (
          <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t('nothingFound')}
          </p>
        ) : (
          <div
            ref={gridRef}
            className={cn('flex flex-col transition-opacity', q.isPlaceholderData && 'opacity-60')}
            aria-busy={q.isPlaceholderData}
          >
            {/* Плашка висит над первыми плитками и не занимает места — сетка не сдвигается. */}
            <NewItemsPill
              count={isDefaultView ? fresh.count : 0}
              label={tFeed('newPosts', { count: fresh.count })}
              onClick={showNew}
              className="h-0"
            />
            <PostGrid
              posts={posts}
              pending={pending}
              pendingRef={loadMoreRef}
              freshIds={freshIds}
            />
            {failed && <LoadFailed onRetry={retry} busy={q.isFetching} compact />}
          </div>
        )}
      </ContentLayout>
    </>
  )
}
