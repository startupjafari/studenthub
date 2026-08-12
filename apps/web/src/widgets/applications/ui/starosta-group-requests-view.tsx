'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { Inbox } from 'lucide-react'
import {
  ApplicationStatusBadge,
  applicationKeys,
  fetchGroupRequests,
  pickLocale,
  type ApplicationListItem,
} from '../../../entities/application-service'
import { Button, Card, EmptyState, PageHeader, Skeleton } from '../../../shared/ui'

const FILTERS = { limit: 50, sortBy: 'createdAt', sortOrder: 'desc' } as const

// Староста (§2.2): read-only список заявок своей группы. Никаких действий — только просмотр.
export function StarostaGroupRequestsView() {
  const t = useTranslations('Applications')
  const locale = useLocale()
  const q = useQuery({
    queryKey: applicationKeys.groupRequests(FILTERS),
    queryFn: () => fetchGroupRequests(FILTERS),
  })
  const items = q.data?.items ?? []

  return (
    <div className="flex min-h-full w-full flex-col gap-4">
      <PageHeader title={t('groupRequestsTitle')} />

      {q.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[68px] w-full rounded-xl" />
          ))}
        </div>
      ) : q.isError ? (
        <EmptyState
          className="flex-1"
          icon={<Inbox className="size-6" aria-hidden />}
          title={t('loadError')}
          action={
            <Button variant="outline" onClick={() => q.refetch()}>
              {t('retry')}
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          className="flex-1"
          icon={<Inbox className="size-6" aria-hidden />}
          title={t('groupRequestsEmpty')}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((app) => (
            <GroupRow key={app.id} app={app} locale={locale} />
          ))}
        </div>
      )}
    </div>
  )
}

function GroupRow({ app, locale }: { app: ApplicationListItem; locale: string }) {
  const t = useTranslations('Applications')
  const serviceName = pickLocale(app.service as unknown as Record<string, unknown>, 'name', locale)
  const studentName = app.student ? `${app.student.lastName} ${app.student.firstName}` : ''

  return (
    <Card className="flex-row items-center gap-3 p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-xs text-muted-foreground">
            {app.number ?? t('status2_DRAFT')}
          </span>
          <ApplicationStatusBadge status={app.status} />
        </div>
        <span className="truncate font-medium">{serviceName}</span>
        {studentName && (
          <span className="truncate text-xs text-muted-foreground">{studentName}</span>
        )}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {new Date(app.createdAt).toLocaleDateString(locale)}
      </span>
    </Card>
  )
}
