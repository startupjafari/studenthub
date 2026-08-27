'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { Inbox } from 'lucide-react'
import type { ApplicationServiceStatus, ApplicationSort } from '@studenthub/shared-schemas'
import {
  ApplicationStatusBadge,
  applicationKeys,
  fetchApplications,
  pickLocale,
  type ApplicationFilters,
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
  TablePagination,
  TableRow,
  TableSkeletonRows,
  TableText,
  usePagedSort,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { StaffWorkspaceModal } from './staff-workspace'

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
const PAGE_SIZES = [20, 50, 100] as const
// Номер · услуга · студент · статус · подано · срок.
const QUEUE_COLS = ['9rem', '26%', '20%', '11rem', '8rem', '8rem'] as const
// На узком экране остаётся номер, услуга и статус — по ним заявку и ищут.
const HIDE = {
  student: 'hidden lg:table-cell',
  submitted: 'hidden xl:table-cell',
  due: 'hidden md:table-cell',
} as const
// Порядок классов = порядок колонок: скелетон прячет те же, что и шапка.
const SKELETON_COLS = [undefined, undefined, HIDE.student, undefined, HIDE.submitted, HIDE.due]

// Статусы, после которых срок уже не «горит»: заявка закрыта или лежит на выдаче.
const SETTLED = ['ISSUED', 'DELIVERED', 'REJECTED', 'CANCELLED', 'READY', 'READY_FOR_PICKUP']

function isOverdue(app: ApplicationListItem): boolean {
  return !!app.dueAt && new Date(app.dueAt).getTime() < Date.now() && !SETTLED.includes(app.status)
}

// Рабочая очередь деканата (§16): фильтр в шапке, таблица с серверной сортировкой
// и пагинацией, обработка заявки — в модальном окне поверх очереди. Счётчики-плитки
// убраны: те же числа есть на «Сегодня», а здесь они отнимали высоту у самой очереди.
export function DeanApplicationsView() {
  const t = useTranslations('Applications')
  const locale = useLocale()
  const [openId, setOpenId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  // Сортировка серверная: упорядочена вся выборка, а не открытая страница.
  const { page, limit, sort, toggle, setPage, setLimit } = usePagedSort<ApplicationSort>(
    PAGE_SIZES[0],
  )

  const filters: ApplicationFilters = {
    page,
    limit,
    // Без явного выбора — свежие сверху: очередь разбирают с новых заявок.
    sortBy: sort ? (sort.key as ApplicationSort) : 'submittedAt',
    sortOrder: sort ? sort.dir : 'desc',
    ...(filter === 'overdue' ? { overdue: true } : filter !== 'all' ? { status: filter } : {}),
  }
  const listQ = useQuery({
    queryKey: applicationKeys.list(filters),
    queryFn: () => fetchApplications(filters),
    placeholderData: (prev) => prev,
  })

  const items = listQ.data?.items ?? []
  const total = listQ.data?.total ?? 0

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <PageHeader
        title={t('queueTitle')}
        // Фильтр статусов — в шапке, как разделы на экране документов: единый
        // SegmentedTabs вместо самодельных чипов под заголовком (DESIGN_SYSTEM §10.1).
        tabs={
          <SegmentedTabs
            aria-label={t('queueTitle')}
            value={filter}
            onChange={(next) => {
              setFilter(next)
              setPage(1)
            }}
            items={FILTERS.map((f) => ({
              value: f,
              label:
                f === 'all'
                  ? t('allFilter')
                  : f === 'overdue'
                    ? t('overdueLabel')
                    : t(`status2_${f}`),
            }))}
          />
        }
      />

      {listQ.isError ? (
        <EmptyState
          icon={<Inbox className="size-6" aria-hidden />}
          title={t('loadError')}
          action={
            <Button variant="outline" onClick={() => listQ.refetch()}>
              {t('retry')}
            </Button>
          }
        />
      ) : !listQ.isPending && total === 0 ? (
        <EmptyState icon={<Inbox className="size-6" aria-hidden />} title={t('queueEmpty')} />
      ) : (
        // `gap-0 py-0`: собственные отступы карточки дали бы полосу над шапкой таблицы
        // и просвет под последней строкой — таблица занимает карточку целиком.
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={QUEUE_COLS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('numberLabel')}</TableHead>
                <TableHead>{t('serviceColumn')}</TableHead>
                <TableHead className={HIDE.student}>{t('studentLabel')}</TableHead>
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
              {listQ.isPending && <TableSkeletonRows columns={SKELETON_COLS} />}
              {items.map((app) => {
                const overdue = isOverdue(app)
                return (
                  <TableRow
                    key={app.id}
                    tabIndex={0}
                    aria-haspopup="dialog"
                    onClick={() => setOpenId(app.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setOpenId(app.id)
                      }
                    }}
                    className="cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                  >
                    <TableCell className="font-medium">
                      <TableText value={app.number} />
                    </TableCell>
                    <TableCell>
                      <TableText
                        value={pickLocale(
                          app.service as unknown as Record<string, unknown>,
                          'name',
                          locale,
                        )}
                      />
                    </TableCell>
                    <TableCell className={cn(HIDE.student, 'text-muted-foreground')}>
                      {app.student ? (
                        <TableText value={`${app.student.lastName} ${app.student.firstName}`} />
                      ) : (
                        <TableEmpty />
                      )}
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
                        // Просрочку показываем цветом самой даты: отдельная колонка-флаг
                        // дублировала бы то, что и так видно по сроку.
                        overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {app.dueAt ? new Date(app.dueAt).toLocaleDateString(locale) : <TableEmpty />}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            total={total}
            limit={limit}
            onPageChange={setPage}
            limitOptions={PAGE_SIZES}
            onLimitChange={setLimit}
          />
        </Card>
      )}

      {openId && <StaffWorkspaceModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
