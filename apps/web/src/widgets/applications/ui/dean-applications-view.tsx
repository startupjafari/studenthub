'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { Inbox } from 'lucide-react'
import type { ApplicationServiceStatus } from '@studenthub/shared-schemas'
import {
  ApplicationStatusBadge,
  applicationKeys,
  fetchApplications,
  fetchQueueStats,
  pickLocale,
  type ApplicationFilters,
  type ApplicationListItem,
} from '../../../entities/application-service'
import { Button, Card, EmptyState, PageHeader, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { StaffWorkspace } from './staff-workspace'

type Filter = 'all' | 'overdue' | ApplicationServiceStatus
const FILTERS: Filter[] = [
  'all',
  'SUBMITTED',
  'IN_REVIEW',
  'IN_PREPARATION',
  'NEEDS_CORRECTION',
  'READY_FOR_PICKUP',
  'overdue',
]
const PAGE = 20

// Рабочая очередь деканата (§16): счётчики + фильтры + серверная пагинация. Клик → рабочее место.
export function DeanApplicationsView() {
  const t = useTranslations('Applications')
  const locale = useLocale()
  const [openId, setOpenId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(1)

  const statsQ = useQuery({ queryKey: [...applicationKeys.all, 'stats'], queryFn: fetchQueueStats })

  const filters: ApplicationFilters = {
    page,
    limit: PAGE,
    sortBy: 'submittedAt',
    sortOrder: 'desc',
    ...(filter === 'overdue' ? { overdue: true } : filter !== 'all' ? { status: filter } : {}),
  }
  const listQ = useQuery({
    queryKey: applicationKeys.list(filters),
    queryFn: () => fetchApplications(filters),
  })

  if (openId) {
    return <StaffWorkspace id={openId} onBack={() => setOpenId(null)} />
  }

  const items = listQ.data?.items ?? []
  const total = listQ.data?.total ?? 0
  const stats = statsQ.data

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader title={t('queueTitle')} />

      {/* Счётчики */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label={t('statNew')} value={stats?.new} />
        <Stat label={t('statInWork')} value={stats?.inWork} />
        <Stat label={t('statActionNeeded')} value={stats?.actionNeeded} />
        <Stat label={t('statReady')} value={stats?.ready} />
        <Stat label={t('statOverdue')} value={stats?.overdue} tone="danger" />
      </div>

      {/* Фильтры */}
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => {
              setFilter(f)
              setPage(1)
            }}
            className={cn(
              'shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
              filter === f
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {f === 'all' ? t('allFilter') : f === 'overdue' ? t('overdueLabel') : t(`status2_${f}`)}
          </button>
        ))}
      </div>

      {listQ.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : listQ.isError ? (
        <EmptyState
          icon={<Inbox className="size-6" aria-hidden />}
          title={t('loadError')}
          action={
            <Button variant="outline" onClick={() => listQ.refetch()}>
              {t('retry')}
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState icon={<Inbox className="size-6" aria-hidden />} title={t('queueEmpty')} />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {items.map((app) => (
              <QueueRow key={app.id} app={app} locale={locale} onOpen={() => setOpenId(app.id)} />
            ))}
          </div>
          {/* Серверная пагинация */}
          {total > PAGE && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {t('backBtn')}
              </Button>
              <span className="text-xs text-muted-foreground">
                {page} / {Math.ceil(total / PAGE)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= Math.ceil(total / PAGE)}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('nextBtn')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value?: number; tone?: 'danger' }) {
  return (
    <Card className="flex flex-col gap-0.5 p-3">
      <span
        className={cn(
          'text-xl font-bold',
          tone === 'danger' && value ? 'text-destructive' : undefined,
        )}
      >
        {value ?? '—'}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </Card>
  )
}

function QueueRow({
  app,
  locale,
  onOpen,
}: {
  app: ApplicationListItem
  locale: string
  onOpen: () => void
}) {
  const t = useTranslations('Applications')
  const overdue =
    app.dueAt &&
    new Date(app.dueAt).getTime() < Date.now() &&
    !['ISSUED', 'DELIVERED', 'REJECTED', 'CANCELLED', 'READY', 'READY_FOR_PICKUP'].includes(
      app.status,
    )
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
      className="flex cursor-pointer items-center gap-3 p-3 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium text-muted-foreground">{app.number}</span>
          <ApplicationStatusBadge status={app.status} />
          {overdue && (
            <span className="text-xs font-medium text-destructive">{t('overdueLabel')}</span>
          )}
        </div>
        <span className="truncate text-sm font-medium">
          {pickLocale(app.service as unknown as Record<string, unknown>, 'name', locale)}
        </span>
        {app.student && (
          <span className="truncate text-xs text-muted-foreground">
            {app.student.lastName} {app.student.firstName}
          </span>
        )}
      </div>
      {app.dueAt && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {new Date(app.dueAt).toLocaleDateString(locale)}
        </span>
      )}
    </Card>
  )
}
