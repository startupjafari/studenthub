'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { BarChart3 } from 'lucide-react'
import { fetchPollsByUser, pollKeys, type PollView } from '../../../entities/poll'
import { EmptyState, Skeleton } from '../../../shared/ui'
import { PollCard } from './poll-card'
import { PollCreateModal } from './poll-create-modal'
import { ContentLayout, FilterGroup, FilterOption, FilterSkeleton } from './filter-sidebar'
import { useRetryOnError } from './use-retry-on-error'
import { useProgressive } from './use-progressive'

interface Props {
  userId: string
  isOwner: boolean
  openCreate?: number
  onConsumed?: () => void
}

type PollFilter = 'all' | 'active' | 'closed' | 'DRAFT'
type PollSort = 'new' | 'popular'

export function ProfilePolls({ userId, isOwner, openCreate, onConsumed }: Props) {
  const t = useTranslations('Profile')
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState<PollFilter>('all')
  const [sort, setSort] = useState<PollSort>('new')

  useEffect(() => {
    if (openCreate === undefined) return
    setCreating(true)
    onConsumed?.()
  }, [openCreate])

  const q = useQuery({ queryKey: pollKeys.byUser(userId), queryFn: () => fetchPollsByUser(userId) })
  // При ошибке — держим скелетон, тост каждые 5 сек и повтор запроса.
  useRetryOnError(q.isError, q.refetch, t('loadRetry'))
  const polls = q.data ?? []
  const visible = useMemo(() => {
    const match = (p: PollView) => {
      if (filter === 'active') return !p.closed && p.status === 'PUBLISHED'
      if (filter === 'closed') return p.closed
      if (filter === 'DRAFT') return p.status === 'DRAFT'
      return true
    }
    return [...polls.filter(match)].sort((a, b) =>
      sort === 'popular'
        ? b.participants - a.participants
        : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
  }, [polls, filter, sort])
  const { shown, pending, sentinelRef } = useProgressive(visible.length, 10, `${filter}|${sort}`)
  const counts = useMemo(
    () => ({
      all: polls.length,
      active: polls.filter((p) => !p.closed && p.status === 'PUBLISHED').length,
      closed: polls.filter((p) => p.closed).length,
      DRAFT: polls.filter((p) => p.status === 'DRAFT').length,
    }),
    [polls],
  )

  const modal = creating && <PollCreateModal userId={userId} onClose={() => setCreating(false)} />

  if (q.isLoading || q.isError) {
    return (
      <>
        {modal}
        <ContentLayout sidebar={<FilterSkeleton groups={2} />}>
          <div className="grid gap-4 xl:grid-cols-2" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <PollSkeleton key={i} />
            ))}
          </div>
        </ContentLayout>
      </>
    )
  }
  if (polls.length === 0) {
    return (
      <>
        {modal}
        <EmptyState
          icon={<BarChart3 className="size-6" aria-hidden />}
          title={t('pollsEmpty')}
          className="min-h-[calc(100dvh_-_20rem)]"
        />
      </>
    )
  }

  const sidebar = (
    <>
      <FilterGroup title={t('filterBy')}>
        <FilterOption
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          label={t('filterAll')}
          count={counts.all}
        />
        <FilterOption
          active={filter === 'active'}
          onClick={() => setFilter('active')}
          label={t('pollActive')}
          count={counts.active}
        />
        <FilterOption
          active={filter === 'closed'}
          onClick={() => setFilter('closed')}
          label={t('pollClosed')}
          count={counts.closed}
        />
        {isOwner && (
          <FilterOption
            active={filter === 'DRAFT'}
            onClick={() => setFilter('DRAFT')}
            label={t('filterDrafts')}
            count={counts.DRAFT}
          />
        )}
      </FilterGroup>
      <FilterGroup title={t('sortBy')}>
        <FilterOption active={sort === 'new'} onClick={() => setSort('new')} label={t('sortNew')} />
        <FilterOption
          active={sort === 'popular'}
          onClick={() => setSort('popular')}
          label={t('sortPopular')}
        />
      </FilterGroup>
    </>
  )

  return (
    <>
      {modal}
      <ContentLayout sidebar={sidebar}>
        {visible.length === 0 ? (
          <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t('nothingFound')}
          </p>
        ) : (
          // Карточки ряда — одной высоты: подвал с участниками стоит на одной линии.
          <div className="grid gap-4 xl:grid-cols-2">
            {visible.slice(0, shown).map((poll) => (
              <PollCard key={poll.id} poll={poll} isOwner={isOwner} />
            ))}
            {Array.from({ length: pending }, (_, j) => (
              <PollSkeleton key={`pending-${j}`} />
            ))}
          </div>
        )}
        <div ref={sentinelRef} aria-hidden />
      </ContentLayout>
    </>
  )
}

// Скелетон карточки опроса — той же формы, что и карточка: строка статуса, вопрос, три
// варианта и подвал. Догруженные опросы встают на его место без сдвига соседей.
function PollSkeleton() {
  return (
    <div
      className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      aria-hidden
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="ml-auto h-3 w-12" />
      </div>
      <Skeleton className="h-5 w-3/4" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
      <div className="mt-auto flex items-center justify-between border-t border-border pt-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-28 rounded-xl" />
      </div>
    </div>
  )
}
