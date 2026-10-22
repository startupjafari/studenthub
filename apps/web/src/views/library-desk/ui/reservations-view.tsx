'use client'

import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useFormatter, useTranslations } from 'next-intl'
import { BookmarkCheck, Search } from 'lucide-react'
import type { ReservationItem } from '@studenthub/shared-schemas'
import {
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  SegmentedTabs,
  Skeleton,
  TablePagination,
  useConfirm,
} from '../../../shared/ui'
import {
  BookCover,
  ReservationBadge,
  cancelReservationRequest,
  fetchReservations,
  libraryKeys,
} from '../../../entities/library'
import { useDeskErrors } from '../lib/desk-errors'

// Брони у библиотекаря (Фаза 20.8): полка броней — готовые, с номером экземпляра и сроком,
// очередь на книги и закрытые. Бронь можно снять, если читатель передумал.

const PAGE_SIZES = [20, 50, 100] as const
const DEBOUNCE_MS = 250

type Filter = 'ready' | 'queued' | 'closed' | 'all'

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
    <div className="flex w-full flex-col gap-4">
      <PageHeader title={t('reservationsTitle')} subtitle={t('reservationsSubtitle')} />
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
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
        <div className="relative w-full md:ml-auto md:w-72">
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
      </div>

      {list.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : list.isError ? (
        <EmptyState
          icon={<BookmarkCheck className="size-6" aria-hidden />}
          title={t('reservationsLoadError')}
          action={
            <Button type="button" variant="outline" onClick={() => void list.refetch()}>
              {tCommon('retry')}
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BookmarkCheck className="size-6" aria-hidden />}
          title={debounced ? t('nothingFound') : t('noReservations')}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {items.map((r) => (
              <li key={r.id}>
                <Card className="flex-row items-center gap-3 px-4 py-3">
                  <BookCover url={r.book.coverUrl} title={r.book.title} className="w-10" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-semibold">{r.book.title}</span>
                    <span className="truncate text-sm text-muted-foreground">
                      {[
                        r.reader.name,
                        r.reader.group,
                        r.copy ? t('inventoryShort', { number: r.copy.inventoryNumber }) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('resCreatedOn', {
                        date: format.dateTime(new Date(r.createdAt), {
                          day: 'numeric',
                          month: 'short',
                        }),
                      })}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                    <ReservationBadge reservation={r} />
                    {(r.status === 'READY' || r.status === 'QUEUED') && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void cancel(r)}
                      >
                        {t('resCancel')}
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          <Card className="gap-0 py-0">
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
        </>
      )}
    </div>
  )
}
