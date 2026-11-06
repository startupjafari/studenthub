'use client'

import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useFormatter, useTranslations } from 'next-intl'
import { BookmarkCheck, Search, X } from 'lucide-react'
import type { ReservationItem } from '@studenthub/shared-schemas'
import {
  Button,
  Card,
  EmptyState,
  Input,
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
  useConfirm,
} from '../../../shared/ui'
import {
  ReservationBadge,
  cancelReservationRequest,
  fetchReservations,
  libraryKeys,
} from '../../../entities/library'
import { useDeskErrors } from '../lib/desk-errors'

// Брони у библиотекаря (Фаза 20.8): полка броней — готовые, с номером экземпляра и сроком,
// очередь на книги и закрытые. Бронь можно снять, если читатель передумал. Таблица во всю
// высоту (DESIGN_SYSTEM §10.7), фильтр и поиск — в шапке.

const PAGE_SIZES = [20, 50, 100] as const
const DEBOUNCE_MS = 250

type Filter = 'ready' | 'queued' | 'closed' | 'all'

// Книга · читатель · экземпляр · создана · статус · действие.
const COLS = ['30%', '24%', '12%', '12%', 'calc(22% - 3.5rem)', '3.5rem'] as const
const COLS_NARROW = ['55%', '0', '0', '0', 'calc(45% - 3.5rem)', '3.5rem'] as const
const HIDE = {
  reader: 'hidden md:table-cell',
  copy: 'hidden lg:table-cell',
  created: 'hidden lg:table-cell',
} as const
const SKELETON_COLS = [undefined, HIDE.reader, HIDE.copy, HIDE.created, undefined, undefined]

export function ReservationsView() {
  const t = useTranslations('LibraryDesk')
  const tCommon = useTranslations('Common')
  const format = useFormatter()
  const describe = useDeskErrors()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<Filter>('ready')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])

  useEffect(() => {
    const next = search.trim().slice(0, 100)
    if (next === debounced) return
    const timer = setTimeout(() => {
      setDebounced(next)
      setPage(1)
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search, debounced])

  const params = { filter, page, limit, ...(debounced ? { q: debounced } : {}) }
  const list = useQuery({
    queryKey: libraryKeys.reservations(params),
    queryFn: () => fetchReservations(params),
    placeholderData: keepPreviousData,
  })
  const items = list.data?.items ?? []

  const cancelMut = useMutation({
    mutationFn: cancelReservationRequest,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: libraryKeys.all })
      toast.success(t('resCancelledToast'))
    },
    onError: (e) => void toast.error(describe(e)),
  })

  async function cancel(r: ReservationItem): Promise<void> {
    const ok = await confirm({
      title: t('resCancelTitle'),
      description: t('resCancelDesc', { title: r.book.title, name: r.reader.name }),
      confirmLabel: t('resCancel'),
      destructive: true,
    })
    if (ok) cancelMut.mutate(r.id)
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6">
      <PageHeader
        title={t('reservationsTitle')}
        subtitle={t('reservationsSubtitle')}
        tabs={
          <SegmentedTabs<Filter>
            value={filter}
            aria-label={t('filter')}
            onChange={(v) => {
              setFilter(v)
              setPage(1)
            }}
            items={[
              { value: 'ready', label: t('resFilterReady') },
              { value: 'queued', label: t('resFilterQueued') },
              { value: 'closed', label: t('filterClosed') },
              { value: 'all', label: t('filterAll') },
            ]}
          />
        }
        actions={
          <div className="relative w-full sm:w-64">
            <Search
              className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              size="md"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchReservations')}
              aria-label={t('searchReservations')}
              className="pl-9"
            />
          </div>
        }
      />

      {list.isError ? (
        <EmptyState
          icon={<BookmarkCheck className="size-6" aria-hidden />}
          title={t('reservationsLoadError')}
          action={
            <Button type="button" variant="outline" onClick={() => void list.refetch()}>
              {tCommon('retry')}
            </Button>
          }
        />
      ) : items.length === 0 && !list.isPending ? (
        <EmptyState
          icon={<BookmarkCheck className="size-6" aria-hidden />}
          title={debounced ? t('nothingFound') : t('noReservations')}
        />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colBook')}</TableHead>
                <TableHead className={HIDE.reader}>{t('colReader')}</TableHead>
                <TableHead className={HIDE.copy}>{t('colCopy')}</TableHead>
                <TableHead className={HIDE.created}>{t('colCreated')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('resCancel')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isPending && <TableSkeletonRows columns={SKELETON_COLS} />}
              {items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="flex min-w-0 flex-col">
                      <TableText value={r.book.title} className="font-medium" />
                      <span className="truncate text-xs text-muted-foreground md:hidden">
                        {r.reader.name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className={HIDE.reader}>
                    <div className="flex min-w-0 flex-col">
                      <TableText value={r.reader.name} />
                      <span className="truncate text-xs text-muted-foreground">
                        {r.reader.group}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className={HIDE.copy}>
                    {r.copy ? (
                      <span className="font-mono text-sm tabular-nums">
                        {r.copy.inventoryNumber}
                      </span>
                    ) : (
                      <TableEmpty />
                    )}
                  </TableCell>
                  <TableCell className={HIDE.created}>
                    <span className="text-sm">
                      {format.dateTime(new Date(r.createdAt), { day: 'numeric', month: 'short' })}
                    </span>
                  </TableCell>
                  <TableCell>
                    <ReservationBadge reservation={r} />
                  </TableCell>
                  <TableCell>
                    {(r.status === 'READY' || r.status === 'QUEUED') && (
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          icon
                          aria-label={t('resCancel')}
                          title={t('resCancel')}
                          onClick={() => void cancel(r)}
                        >
                          <X className="size-4" aria-hidden />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            total={list.data?.total ?? 0}
            limit={limit}
            onPageChange={setPage}
            limitOptions={PAGE_SIZES}
            onLimitChange={(n) => {
              setLimit(n)
              setPage(1)
            }}
          />
        </Card>
      )}
    </div>
  )
}
