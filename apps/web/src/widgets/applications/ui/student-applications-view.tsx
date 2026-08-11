'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { Plus, Inbox } from 'lucide-react'
import type { ApplicationServiceStatus } from '@studenthub/shared-schemas'
import {
  applicationKeys,
  fetchApplications,
  type ApplicationListItem,
} from '../../../entities/application-service'
import { Button, EmptyState, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
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

  const q = useQuery({
    queryKey: applicationKeys.list({ limit: 50, sortBy: 'createdAt', sortOrder: 'desc' }),
    queryFn: () => fetchApplications({ limit: 50, sortBy: 'createdAt', sortOrder: 'desc' }),
  })

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

  if (screen.name === 'create') {
    return (
      <Shell>
        <CreateWizard
          onDone={(id) => setScreen({ name: 'detail', id })}
          onCancel={() => setScreen({ name: 'list' })}
        />
      </Shell>
    )
  }
  if (screen.name === 'edit') {
    return (
      <Shell>
        <CreateWizard
          initialDraftId={screen.id}
          onDone={(id) => setScreen({ name: 'detail', id })}
          onCancel={() => setScreen({ name: 'list' })}
        />
      </Shell>
    )
  }
  if (screen.name === 'detail') {
    return (
      <Shell>
        <ApplicationDetail
          id={screen.id}
          onBack={() => setScreen({ name: 'list' })}
          onContinueDraft={(id) => setScreen({ name: 'edit', id })}
        />
      </Shell>
    )
  }

  const current = grouped[tab]

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t('myApplications')}</h1>
        <Button onClick={() => setScreen({ name: 'create' })}>
          <Plus className="size-4" aria-hidden />
          {t('createApplication')}
        </Button>
      </div>

      {/* Вкладки — горизонтальный скролл на мобильном */}
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {TAB_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
              tab === id
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {t(TAB_LABEL[id])}
            {grouped[id].length > 0 && (
              <span className="ml-1.5 opacity-70">{grouped[id].length}</span>
            )}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[76px] w-full rounded-xl" />
          ))}
        </div>
      ) : q.isError ? (
        <EmptyState
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
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Формы/деталь — комфортная колонка для чтения; список — на всю ширину контентного блока.
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl">{children}</div>
}
