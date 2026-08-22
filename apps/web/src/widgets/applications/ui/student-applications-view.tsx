'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Inbox } from 'lucide-react'
import { REALTIME_EVENTS, type ApplicationServiceStatus } from '@studenthub/shared-schemas'
import {
  applicationKeys,
  fetchApplications,
  fetchApplication,
  type ApplicationListItem,
} from '../../../entities/application-service'
import { Button, EmptyState, PageHeader, SegmentedTabs, Skeleton } from '../../../shared/ui'
import { useRealtimeEnvelope } from '../../../shared/realtime'
import { ApplicationCard } from './application-card'
import { ApplicationDetail } from './application-detail'
import { CreateWizard } from './create-wizard'

type TabId = 'active' | 'actionNeeded' | 'ready' | 'done' | 'drafts'

const TAB_STATUSES: Record<TabId, ApplicationServiceStatus[]> = {
  active: ['SUBMITTED', 'IN_REVIEW', 'RESUBMITTED', 'IN_PREPARATION'],
  actionNeeded: ['NEEDS_CORRECTION'],
  ready: ['READY', 'READY_FOR_PICKUP'],
  done: ['ISSUED', 'DELIVERED', 'REJECTED', 'CANCELLED'],
  drafts: ['DRAFT'],
}
const TAB_LABEL: Record<TabId, string> = {
  active: 'tabActive',
  actionNeeded: 'tabActionNeeded',
  ready: 'tabReady',
  done: 'tabDone',
  drafts: 'tabDrafts',
}
const TAB_ORDER: TabId[] = ['active', 'actionNeeded', 'ready', 'done', 'drafts']

type Screen =
  | { name: 'list' }
  | { name: 'create' }
  | { name: 'edit'; id: string }
  | { name: 'detail'; id: string }

// Экран заявок студента (§29): вкладки + карточки + мастер создания + деталь.
export function StudentApplicationsView() {
  const t = useTranslations('Applications')
  const [screen, setScreen] = useState<Screen>({ name: 'list' })
  const [tab, setTab] = useState<TabId>('active')

  const qc = useQueryClient()
  const q = useQuery({
    queryKey: applicationKeys.list({ limit: 50, sortBy: 'createdAt', sortOrder: 'desc' }),
    queryFn: () => fetchApplications({ limit: 50, sortBy: 'createdAt', sortOrder: 'desc' }),
  })

  // Realtime: сотрудник сменил статус заявки → WS-событие владельцу; обновляем список и
  // открытую деталь без опроса (invalidate по префиксу applicationKeys.all).
  useRealtimeEnvelope(REALTIME_EVENTS.applicationStatusChanged, () => {
    void qc.invalidateQueries({ queryKey: applicationKeys.all })
  })

  // Prefetch детали заявки при наведении/фокусе карточки (принцип 3) — открытие мгновенное.
  const prefetch = (id: string): void => {
    void qc.prefetchQuery({
      queryKey: applicationKeys.detail(id),
      queryFn: () => fetchApplication(id),
      staleTime: 30_000,
    })
  }

  const grouped = useMemo(() => {
    const items = q.data?.items ?? []
    const by: Record<TabId, ApplicationListItem[]> = {
      active: [],
      actionNeeded: [],
      ready: [],
      done: [],
      drafts: [],
    }
    for (const app of items) {
      const tabId = TAB_ORDER.find((id) => TAB_STATUSES[id].includes(app.status))
      if (tabId) by[tabId].push(app)
    }
    return by
  }, [q.data])

  if (screen.name === 'create' || screen.name === 'edit') {
    return (
      <CreateWizard
        initialDraftId={screen.name === 'edit' ? screen.id : undefined}
        onDone={(id) => setScreen({ name: 'detail', id })}
        onCancel={() => setScreen({ name: 'list' })}
      />
    )
  }
  if (screen.name === 'detail') {
    return (
      <ApplicationDetail
        id={screen.id}
        onBack={() => setScreen({ name: 'list' })}
        onContinueDraft={(id) => setScreen({ name: 'edit', id })}
      />
    )
  }

  const current = grouped[tab]

  // Табы — общий SegmentedTabs, встраивается в шапку рядом с заголовком.
  const tabsNode = (
    <SegmentedTabs
      aria-label={t('myApplications')}
      value={tab}
      onChange={setTab}
      items={TAB_ORDER.map((id) => ({
        value: id,
        label: t(TAB_LABEL[id]),
        count: grouped[id].length,
      }))}
    />
  )

  return (
    <div className="flex min-h-full w-full flex-col gap-4">
      <PageHeader
        title={t('myApplications')}
        tabs={tabsNode}
        actions={
          <Button size="sm" onClick={() => setScreen({ name: 'create' })}>
            <Plus className="size-4" aria-hidden />
            {t('createApplication')}
          </Button>
        }
      />

      {q.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[76px] w-full rounded-xl" />
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
      ) : current.length === 0 ? (
        <EmptyState
          className="flex-1"
          icon={<Inbox className="size-6" aria-hidden />}
          title={t('noApplications')}
          description={t('noApplicationsHint')}
          action={
            <Button onClick={() => setScreen({ name: 'create' })}>
              <Plus className="size-4" aria-hidden />
              {t('createApplication')}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {current.map((app) => (
            <ApplicationCard
              key={app.id}
              app={app}
              onOpen={() => setScreen({ name: 'detail', id: app.id })}
              onPrefetch={() => prefetch(app.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
