'use client'

import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { Search, ShieldCheck } from 'lucide-react'
import {
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
  TablePagination,
} from '../../../shared/ui'
import { fetchIdAccess, libraryKeys } from '../../../entities/library'
import { LibraryAdminTabs } from './library-admin-tabs'

// Журнал просмотров удостоверений (Фаза 20.6, docs/PROJECT.md §3.11): кто из библиотекарей,
// чью карточку, по какой выдаче, когда и с какого адреса открывал. Как журнал камер — для
// разбора жалоб, а не для слежки: только чтение.

const PAGE_SIZES = [20, 50, 100] as const
const DEBOUNCE_MS = 250

export function IdAccessView() {
  const t = useTranslations('LibraryAdmin')
  const tCommon = useTranslations('Common')
  const format = useFormatter()
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

  const params = { page, limit, ...(debounced ? { q: debounced } : {}) }
  const journal = useQuery({
    queryKey: libraryKeys.idAccess(params),
    queryFn: () => fetchIdAccess(params),
    placeholderData: keepPreviousData,
  })
  const items = journal.data?.items ?? []

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader
        title={t('journalTitle')}
        subtitle={t('journalSubtitle')}
        tabs={<LibraryAdminTabs />}
      />
      <div className="relative w-full md:w-72">
        <Search
          className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          size="md"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('journalSearch')}
          aria-label={t('journalSearch')}
          className="pl-9"
        />
      </div>
      {journal.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : journal.isError ? (
        <EmptyState
          icon={<ShieldCheck className="size-6" aria-hidden />}
          title={t('journalLoadError')}
          action={
            <Button type="button" variant="outline" onClick={() => void journal.refetch()}>
              {tCommon('retry')}
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="size-6" aria-hidden />}
          title={debounced ? t('journalNothingFound') : t('journalEmpty')}
          description={debounced ? undefined : t('journalEmptyHint')}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {items.map((row) => (
              <li key={row.id}>
                <Card className="flex-col gap-1 px-4 py-3 md:flex-row md:items-center md:gap-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-medium">
                      {t('journalRow', { librarian: row.librarianName, reader: row.readerName })}
                    </span>
                    <span className="truncate text-sm text-muted-foreground">
                      {[row.bookTitle, row.ip].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <time
                    dateTime={row.createdAt}
                    className="shrink-0 text-sm text-muted-foreground tabular-nums"
                  >
                    {format.dateTime(new Date(row.createdAt), {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </Card>
              </li>
            ))}
          </ul>
          <Card className="gap-0 py-0">
            <TablePagination
              page={page}
              total={journal.data?.total ?? 0}
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
