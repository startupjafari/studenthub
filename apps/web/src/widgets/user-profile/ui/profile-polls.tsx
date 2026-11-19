'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { BarChart3 } from 'lucide-react'
import { deletePoll, type PollView } from '../../../entities/poll'
import { useContentOwner } from '../lib/content-owner'
import { ownerPollsKey, ownerPollsQuery } from '../lib/owner-queries'
import { EmptyState, Modal, MosaicGrid, useConfirm } from '../../../shared/ui'
import { PollCard } from './poll-card'
import { PollTile, PollTileSkeleton } from './poll-tile'
import { PollCreateModal } from './poll-create-modal'
import { ContentLayout, FilterGroup, FilterOption, FilterSkeleton } from './filter-sidebar'
import { useRetryOnError } from './use-retry-on-error'
import { LoadFailed } from './load-failed'
import { useProgressive } from './use-progressive'
import type { ContentModeration } from '../lib/content-moderation'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

interface Props {
  userId: string
  isOwner: boolean
  moderation?: ContentModeration
  openCreate?: number
  onConsumed?: () => void
}

type PollFilter = 'all' | 'active' | 'closed' | 'DRAFT'
type PollSort = 'new' | 'popular'

export function ProfilePolls({ userId, isOwner, moderation, openCreate, onConsumed }: Props) {
  const t = useTranslations('Profile')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState<PollFilter>('all')
  const [sort, setSort] = useState<PollSort>('new')
  // Открытый опрос — по id, а не снимком: после голоса список перезапрашивается, и окно
  // показывает свежие итоги из него же.
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    if (openCreate === undefined) return
    setCreating(true)
    onConsumed?.()
  }, [openCreate])

  const owner = useContentOwner(userId)
  const q = useQuery(ownerPollsQuery(owner))
  // Ошибка — один тост и повторы с растущей паузой; не помогло — ошибка на месте вкладки.
  const loadState = useRetryOnError(q, t('loadRetry'))
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
  // Порция — 12 плиток: делится и на 3, и на 4 колонки, догрузка достраивает ряды целиком.
  const { shown, pending, sentinelRef } = useProgressive(visible.length, 12, `${filter}|${sort}`)
  const counts = useMemo(
    () => ({
      all: polls.length,
      active: polls.filter((p) => !p.closed && p.status === 'PUBLISHED').length,
      closed: polls.filter((p) => p.closed).length,
      DRAFT: polls.filter((p) => p.status === 'DRAFT').length,
    }),
    [polls],
  )
  // Опрос удалили (с плитки, в окне или с другого устройства) — его нет в списке, и окно
  // закрывается само: показывать в нём уже нечего.
  const openPoll = openId ? polls.find((p) => p.id === openId) : undefined
  const canModerate = !isOwner && !!moderation?.content

  // Удаление с плитки. В окне опроса удаляет сама карточка (`PollCard`) — тем же запросом.
  const delMut = useMutation({
    mutationFn: deletePoll,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ownerPollsKey(owner) }),
    onError: (e) => toast.error(tErr(errCode(e))),
  })
  const removePoll = (id: string) => {
    void confirm(
      isOwner
        ? { title: t('pollDeleteConfirm'), destructive: true }
        : {
            title: t('pollDeleteConfirm'),
            description: t('moderationDeleteHint'),
            confirmLabel: t('deleteModeration'),
            destructive: true,
          },
    ).then((ok) => {
      if (ok) delMut.mutate(id)
    })
  }

  const modals = (
    <>
      {creating && <PollCreateModal userId={userId} onClose={() => setCreating(false)} />}
      {/* Окно опроса — та же карточка, что раньше стояла в сетке: голосование, отмена голоса
          и итоги живут только в ней. Окно растёт из нажатой плитки (shared/lib/modal-origin). */}
      {openPoll && (
        <Modal title={t('pollTitle')} onClose={() => setOpenId(null)} size="lg" bodyClassName="p-0">
          <PollCard
            poll={openPoll}
            isOwner={isOwner}
            canModerate={canModerate}
            className="rounded-none bg-transparent ring-0 hover:ring-0"
          />
        </Modal>
      )}
    </>
  )

  if (!q.data && loadState.failed) {
    return (
      <>
        {modals}
        <LoadFailed onRetry={loadState.retry} busy={q.isFetching} />
      </>
    )
  }
  if (!q.data) {
    return (
      <>
        {modals}
        <ContentLayout sidebar={<FilterSkeleton groups={2} />}>
          <MosaicGrid aria-hidden>
            {Array.from({ length: 12 }).map((_, i) => (
              <PollTileSkeleton key={i} />
            ))}
          </MosaicGrid>
        </ContentLayout>
      </>
    )
  }
  if (polls.length === 0) {
    return (
      <>
        {modals}
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
      {modals}
      <ContentLayout sidebar={sidebar}>
        <div className="flex flex-1 flex-col gap-4">
          {visible.length === 0 ? (
            <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {t('nothingFound')}
            </p>
          ) : (
            // Та же сетка, что у постов, фото и статей: ровные квадраты, 3 колонки, на широком
            // контейнере — 4. Полный опрос с голосованием — в окне по нажатию на плитку.
            <MosaicGrid>
              {visible.slice(0, shown).map((poll) => (
                <PollTile
                  key={poll.id}
                  poll={poll}
                  canDelete={isOwner || canModerate}
                  deleteLabel={isOwner ? t('delete') : t('deleteModeration')}
                  onOpen={() => setOpenId(poll.id)}
                  onDelete={() => removePoll(poll.id)}
                />
              ))}
              {Array.from({ length: pending }, (_, j) => (
                <PollTileSkeleton key={`pending-${j}`} ref={j === 0 ? sentinelRef : undefined} />
              ))}
            </MosaicGrid>
          )}
        </div>
      </ContentLayout>
    </>
  )
}
