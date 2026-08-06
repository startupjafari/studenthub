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

  const modal = creating && <PollCreateModal userId={userId} onClose={() => setCreating(false)} />

  if (q.isLoading || q.isError) {
    return (
      <>
        {modal}
        <ContentLayout sidebar={<FilterSkeleton groups={2} />}>
          <div className="grid gap-4 xl:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5"
              >
                <div className="flex items-center gap-2.5">
                  <Skeleton className="size-9 rounded-full" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className="h-3.5 w-1/3" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </div>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-11 w-full rounded-xl" />
                <Skeleton className="h-11 w-full rounded-xl" />
                <Skeleton className="h-11 w-full rounded-xl" />
                <Skeleton className="mt-1 h-3 w-1/3" />
              </div>
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
          className="min-h-[calc(100vh_-_20rem)]"
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
        />
        <FilterOption
          active={filter === 'active'}
          onClick={() => setFilter('active')}
          label={t('pollActive')}
        />
        <FilterOption
          active={filter === 'closed'}
          onClick={() => setFilter('closed')}
          label={t('pollClosed')}
        />
        {isOwner && (
          <FilterOption
            active={filter === 'DRAFT'}
            onClick={() => setFilter('DRAFT')}
            label={t('filterDrafts')}
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
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t('nothingFound')}
          </p>
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-2">
            {visible.map((poll) => (
              <PollCard key={poll.id} poll={poll} isOwner={isOwner} />
            ))}
          </div>
        )}
      </ContentLayout>
    </>
  )
}
