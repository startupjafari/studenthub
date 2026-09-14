'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { Inbox } from 'lucide-react'
import type { ApplicationSort } from '@studenthub/shared-schemas'
import {
  ApplicationStatusBadge,
  applicationKeys,
  fetchGroupRequests,
  pickLocale,
  type ApplicationFilters,
} from '../../../entities/application-service'
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
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

const PAGE_SIZES = [20, 50, 100] as const
// Номер · услуга · студент · статус · подано.
const COLS = ['9rem', '28%', '22%', '11rem', '8rem'] as const
// До `md` остаются услуга, студент и статус — по ним староста и читает список своей
// группы. Доли пересчитаны на эти три колонки: с долями полного набора им доставалось
// бы по 40px вместе с отступами.
const COLS_NARROW = ['0', '40%', '32%', '28%', '0'] as const
const HIDE = {
  number: 'hidden md:table-cell',
  submitted: 'hidden md:table-cell',
} as const
// Порядок классов = порядок колонок: скелетон прячет те же, что и шапка.
const SKELETON_COLS = [HIDE.number, undefined, undefined, undefined, HIDE.submitted]

// Староста (§2.2): read-only список заявок своей группы. Никаких действий — только
// просмотр; сортировка и пагинация серверные, как в очереди деканата.
export function StarostaGroupRequestsView() {
  const t = useTranslations('Applications')
  const locale = useLocale()

  const { page, limit, sort, toggle, setPage, setLimit } = usePagedSort<ApplicationSort>(
    PAGE_SIZES[0],
  )

  const filters: ApplicationFilters = {
    page,
    limit,
    // Без явного выбора — свежие сверху.
    sortBy: sort ? (sort.key as ApplicationSort) : 'createdAt',
    sortOrder: sort ? sort.dir : 'desc',
  }
  const q = useQuery({
    queryKey: applicationKeys.groupRequests(filters),
    queryFn: () => fetchGroupRequests(filters),
    placeholderData: (prev) => prev,
  })

  const items = q.data?.items ?? []
  const total = q.data?.total ?? 0

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <PageHeader title={t('groupRequestsTitle')} />

      {q.isError ? (
        <EmptyState
          icon={<Inbox className="size-6" aria-hidden />}
          title={t('loadError')}
          action={
            <Button variant="outline" onClick={() => q.refetch()}>
              {t('retry')}
            </Button>
          }
        />
      ) : !q.isPending && total === 0 ? (
        <EmptyState
          icon={<Inbox className="size-6" aria-hidden />}
          title={t('groupRequestsEmpty')}
        />
      ) : (
        // `gap-0 py-0`: собственные отступы карточки дали бы полосу над шапкой таблицы
        // и просвет под последней строкой — таблица занимает карточку целиком.
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead className={HIDE.number}>{t('numberLabel')}</TableHead>
                <TableHead>{t('serviceColumn')}</TableHead>
                <TableHead>{t('studentLabel')}</TableHead>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isPending && <TableSkeletonRows columns={SKELETON_COLS} />}
              {items.map((app) => (
                <TableRow key={app.id}>
                  <TableCell className={cn(HIDE.number, 'font-mono text-xs')}>
                    <TableText value={app.number} />
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
                  <TableCell className="text-muted-foreground">
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
                </TableRow>
              ))}
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
    </div>
  )
}
