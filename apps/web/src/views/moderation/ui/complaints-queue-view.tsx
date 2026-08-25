'use client'

import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { ShieldAlert } from 'lucide-react'
import { ADMIN_PAGE_SIZES, type ComplaintSortValue } from '@studenthub/shared-schemas'
import {
  COMPLAINT_PRIORITIES,
  complaintKeys,
  fetchComplaints,
  type Complaint,
  type ComplaintPriorityValue,
  type ComplaintStatusValue,
} from '../../../entities/complaint'
import {
  Card,
  EmptyState,
  PageHeader,
  SegmentedTabs,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  TableSkeletonRows,
  TableText,
  useSortState,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { ComplaintDetailModal } from './complaint-detail-modal'
import { complaintPriority, PRIORITY_STYLE, STATUS_STYLE } from './complaint-badges'

const STATUS_TABS: (ComplaintStatusValue | 'all')[] = ['PENDING', 'RESOLVED', 'DISMISSED', 'all']
const PAGE_SIZES = ADMIN_PAGE_SIZES
// Ширины колонок: приоритет · категория · причина · автор · дата · статус.
const COLS = ['12%', '14%', '30%', '18%', '14%', '12%'] as const

// Очередь модерации: таблица с приоритетом, разбор одной жалобы — в модалке по клику
// на строку. Приоритет считает сервер из категории цели (complaintPriorityFor), поэтому
// порядок по умолчанию — очередь: необработанные → HIGH раньше LOW → свежие раньше.
export function ComplaintsQueueView() {
  const t = useTranslations('Moderation')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const [status, setStatus] = useState<ComplaintStatusValue | 'all'>('PENDING')
  const [priority, setPriority] = useState<ComplaintPriorityValue | 'all'>('all')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])
  const [opened, setOpened] = useState<Complaint | null>(null)
  // Сортировка серверная: упорядочена вся очередь, а не открытая страница.
  const { sort, toggle } = useSortState()

  const query = {
    ...(status === 'all' ? {} : { status }),
    ...(priority === 'all' ? {} : { priority }),
    ...(sort ? { sort: sort.key as ComplaintSortValue, order: sort.dir } : {}),
    page,
    limit,
  }
  const complaints = useQuery({
    queryKey: complaintKeys.list(query),
    queryFn: () => fetchComplaints(query),
    // Прошлая страница остаётся на экране, пока грузится новая.
    placeholderData: keepPreviousData,
  })
  const rows = complaints.data?.items ?? []
  const total = complaints.data?.total ?? 0

  // Новый фильтр или порядок — снова с первой страницы: на прежней странице отфильтрованной
  // очереди может не быть строк вовсе.
  function refilter(apply: () => void): void {
    apply()
    setPage(1)
  }
  const sortBy = (key: string): void => refilter(() => toggle(key))

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <PageHeader
        title={t('complaintsTitle')}
        subtitle={t('complaintsSubtitle')}
        tabs={
          <SegmentedTabs
            aria-label={t('complaintsTitle')}
            value={status}
            onChange={(v) => refilter(() => setStatus(v))}
            items={STATUS_TABS.map((s) => ({
              value: s,
              label: s === 'all' ? t('all') : t(`status${s}`),
            }))}
          />
        }
        actions={
          <Select
            value={priority}
            onValueChange={(v) => refilter(() => setPriority(v as ComplaintPriorityValue | 'all'))}
          >
            <SelectTrigger className="h-9 w-40 text-sm" aria-label={t('colPriority')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allPriorities')}</SelectItem>
              {COMPLAINT_PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`priority${p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {complaints.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : !complaints.isLoading && rows.length === 0 ? (
        <EmptyState icon={<ShieldAlert className="size-6" aria-hidden />} title={t('empty')} />
      ) : (
        // Загрузка не подменяет таблицу серым блоком: шапка, ширины колонок и подвал
        // остаются на месте, скелетон живёт в строках.
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="priority" sort={sort} onSort={sortBy}>
                  {t('colPriority')}
                </TableHead>
                <TableHead sortKey="targetType" sort={sort} onSort={sortBy}>
                  {t('colCategory')}
                </TableHead>
                <TableHead>{t('colReason')}</TableHead>
                <TableHead>{t('reporter')}</TableHead>
                <TableHead sortKey="createdAt" sort={sort} onSort={sortBy}>
                  {t('colDate')}
                </TableHead>
                <TableHead sortKey="status" sort={sort} onSort={sortBy}>
                  {t('colStatus')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {complaints.isLoading && <TableSkeletonRows columns={6} />}
              {rows.map((c) => {
                const priorityValue = complaintPriority(c)
                return (
                  <TableRow
                    key={c.id}
                    tabIndex={0}
                    aria-haspopup="dialog"
                    onClick={() => setOpened(c)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setOpened(c)
                      }
                    }}
                    className="cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                  >
                    <TableCell>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          PRIORITY_STYLE[priorityValue],
                        )}
                      >
                        {t(`priority${priorityValue}`)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <TableText value={t(`target${c.targetType}`)} />
                    </TableCell>
                    <TableCell>
                      <TableText value={c.reason} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <TableText value={`${c.reporter.lastName} ${c.reporter.firstName}`} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {new Date(c.createdAt).toLocaleString(locale, {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          STATUS_STYLE[c.status],
                        )}
                      >
                        {t(`status${c.status}`)}
                      </span>
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
            onLimitChange={(n) => refilter(() => setLimit(n))}
          />
        </Card>
      )}

      {opened && <ComplaintDetailModal complaint={opened} onClose={() => setOpened(null)} />}
    </div>
  )
}
