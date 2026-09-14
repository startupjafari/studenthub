'use client'

import { useCallback, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Inbox } from 'lucide-react'
import { REALTIME_EVENTS, type ApplicationServiceStatus } from '@studenthub/shared-schemas'
import {
  ApplicationStatusBadge,
  applicationKeys,
  fetchApplications,
  fetchApplication,
  pickLocale,
  type ApplicationListItem,
} from '../../../entities/application-service'
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  SegmentedTabs,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  TableText,
  useTableSort,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { useRealtimeEnvelope } from '../../../shared/realtime'
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

// Номер · услуга · статус · подано · срок.
const COLS = ['9rem', '34%', '11rem', '8rem', '8rem'] as const
// До `md` остаются номер, услуга и статус — по ним студент и находит свою заявку.
const COLS_NARROW = ['6.5rem', '50%', '30%', '0', '0'] as const
const HIDE = {
  submitted: 'hidden md:table-cell',
  due: 'hidden lg:table-cell',
} as const
// Порядок классов = порядок колонок: скелетон прячет те же, что и шапка.
const SKELETON_COLS = [undefined, undefined, undefined, HIDE.submitted, HIDE.due]

// Статусы, после которых срок уже не «горит»: заявка закрыта или лежит на выдаче.
const SETTLED = ['ISSUED', 'DELIVERED', 'REJECTED', 'CANCELLED', 'READY', 'READY_FOR_PICKUP']

type Screen = { name: 'list' } | { name: 'detail'; id: string }

// Мастер создания/правки: `null` — закрыт, иначе окно поверх текущего экрана.
// `draftId` задан — правка существующего черновика, пусто — создание с нуля.
type Wizard = { draftId?: string }

// Экран заявок студента (§29): вкладки + карточки + мастер создания + деталь.
export function StudentApplicationsView() {
  const t = useTranslations('Applications')
  const locale = useLocale()
  const [screen, setScreen] = useState<Screen>({ name: 'list' })
  const [wizard, setWizard] = useState<Wizard | null>(null)
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

  const current = grouped[tab]

  // Сортировка клиентская: список заявок студента приходит одним запросом (limit 50) и
  // раскладывается по вкладкам здесь же — серверу пересортировывать нечего.
  const sortValue = useCallback(
    (app: ApplicationListItem, key: string) => {
      switch (key) {
        case 'service':
          return pickLocale(app.service as unknown as Record<string, unknown>, 'name', locale)
        case 'status':
          return t(`status2_${app.status}`)
        case 'submittedAt':
          return app.submittedAt ? new Date(app.submittedAt).getTime() : null
        case 'dueAt':
          return app.dueAt ? new Date(app.dueAt).getTime() : null
        default:
          return app.number
      }
    },
    [locale, t],
  )
  // Без начальной сортировки: порядок приходит с сервера (createdAt desc) — свежие сверху.
  const { rows, sort, toggle } = useTableSort(current, sortValue)

  // Мастер живёт окном поверх текущего экрана: список (или открытая заявка) остаётся
  // под ним — закрыл окно и оказался ровно там, где был, с той же вкладкой и прокруткой.
  const wizardNode = wizard && (
    <CreateWizard
      asModal
      initialDraftId={wizard.draftId}
      onDone={(id) => {
        setWizard(null)
        setScreen({ name: 'detail', id })
      }}
      onCancel={() => setWizard(null)}
    />
  )

  // Заявка открывается окном поверх списка — как и мастер. Продолжение черновика
  // закрывает окно заявки и открывает мастер: две модалки друг над другом не нужны,
  // а по завершении мастер сам вернёт на обновлённую заявку.
  const detailNode = screen.name === 'detail' && (
    <ApplicationDetail
      asModal
      id={screen.id}
      onBack={() => setScreen({ name: 'list' })}
      onContinueDraft={(id) => {
        setScreen({ name: 'list' })
        setWizard({ draftId: id })
      }}
    />
  )

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
    <>
      <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
        <PageHeader
          title={t('myApplications')}
          tabs={tabsNode}
          actions={
            <Button size="sm" onClick={() => setWizard({})}>
              <Plus className="size-4" aria-hidden />
              {t('createApplication')}
            </Button>
          }
        />

        {q.isError ? (
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
        ) : !q.isLoading && current.length === 0 ? (
          <EmptyState
            className="flex-1"
            icon={<Inbox className="size-6" aria-hidden />}
            title={t('noApplications')}
            description={t('noApplicationsHint')}
            action={
              <Button onClick={() => setWizard({})}>
                <Plus className="size-4" aria-hidden />
                {t('createApplication')}
              </Button>
            }
          />
        ) : (
          // `gap-0 py-0`: собственные отступы карточки дали бы полосу над шапкой таблицы
          // и просвет под последней строкой — таблица занимает карточку целиком.
          <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
            <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
              <TableHeader>
                <TableRow>
                  <TableHead sortKey="number" sort={sort} onSort={toggle}>
                    {t('numberLabel')}
                  </TableHead>
                  <TableHead sortKey="service" sort={sort} onSort={toggle}>
                    {t('serviceColumn')}
                  </TableHead>
                  <TableHead sortKey="status" sort={sort} onSort={toggle}>
                    {t('statusColumn')}
                  </TableHead>
                  <TableHead
                    sortKey="submittedAt"
                    sort={sort}
                    onSort={toggle}
                    className={HIDE.submitted}
                  >
                    {t('submittedAtLabel')}
                  </TableHead>
                  <TableHead sortKey="dueAt" sort={sort} onSort={toggle} className={HIDE.due}>
                    {t('dueColumn')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.isLoading && <TableSkeletonRows columns={SKELETON_COLS} />}
                {rows.map((app) => (
                  <TableRow
                    key={app.id}
                    tabIndex={0}
                    onClick={() => setScreen({ name: 'detail', id: app.id })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setScreen({ name: 'detail', id: app.id })
                      }
                    }}
                    // Prefetch детали при наведении/фокусе строки (принцип 3) — открытие мгновенное.
                    onMouseEnter={() => prefetch(app.id)}
                    onFocus={() => prefetch(app.id)}
                    className="cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                  >
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <TableText value={app.number ?? t('status2_DRAFT')} />
                    </TableCell>
                    <TableCell className="font-medium">
                      <TableText
                        value={pickLocale(
                          app.service as unknown as Record<string, unknown>,
                          'name',
                          locale,
                        )}
                      />
                    </TableCell>
                    <TableCell>
                      <ApplicationStatusBadge status={app.status} />
                    </TableCell>
                    <TableCell className={cn(HIDE.submitted, 'text-muted-foreground tabular-nums')}>
                      {app.submittedAt ? (
                        new Date(app.submittedAt).toLocaleDateString(locale)
                      ) : (
                        <TableEmpty />
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        HIDE.due,
                        'tabular-nums',
                        // Срок «горит» только пока по заявке ещё идёт работа.
                        app.dueAt && !SETTLED.includes(app.status)
                          ? 'font-medium'
                          : 'text-muted-foreground',
                      )}
                    >
                      {app.dueAt ? new Date(app.dueAt).toLocaleDateString(locale) : <TableEmpty />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
      {detailNode}
      {wizardNode}
    </>
  )
}
