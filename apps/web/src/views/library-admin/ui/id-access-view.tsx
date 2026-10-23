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
} from '../../../shared/ui'
import { fetchIdAccess, libraryKeys } from '../../../entities/library'
import { LibraryAdminTabs } from './library-admin-tabs'

// Журнал просмотров удостоверений (Фаза 20.6, docs/PROJECT.md §3.11): кто из библиотекарей,
// чью карточку, по какой выдаче, когда и с какого адреса открывал. Как журнал камер — для
// разбора жалоб, а не для слежки: только чтение. Таблица во всю высоту (DESIGN_SYSTEM §10.7).

const PAGE_SIZES = [20, 50, 100] as const
const DEBOUNCE_MS = 250

// Когда · библиотекарь · читатель · книга · IP.
const COLS = ['16%', '22%', '22%', '28%', '12%'] as const
const COLS_NARROW = ['30%', '0', '70%', '0', '0'] as const
const HIDE = {
  librarian: 'hidden md:table-cell',
  book: 'hidden lg:table-cell',
  ip: 'hidden lg:table-cell',
} as const
const SKELETON_COLS = [undefined, HIDE.librarian, undefined, HIDE.book, HIDE.ip]

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
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6">
      <PageHeader
        title={t('journalTitle')}
        subtitle={t('journalSubtitle')}
        tabs={<LibraryAdminTabs />}
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
              placeholder={t('journalSearch')}
              aria-label={t('journalSearch')}
              className="pl-9"
            />
          </div>
        }
      />
      {journal.isError ? (
        <EmptyState
          icon={<ShieldCheck className="size-6" aria-hidden />}
          title={t('journalLoadError')}
          action={
            <Button type="button" variant="outline" onClick={() => void journal.refetch()}>
              {tCommon('retry')}
            </Button>
          }
        />
      ) : items.length === 0 && !journal.isPending ? (
        <EmptyState
          icon={<ShieldCheck className="size-6" aria-hidden />}
          title={debounced ? t('journalNothingFound') : t('journalEmpty')}
          description={debounced ? undefined : t('journalEmptyHint')}
        />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colWhen')}</TableHead>
                <TableHead className={HIDE.librarian}>{t('colLibrarian')}</TableHead>
                <TableHead>{t('colReader')}</TableHead>
                <TableHead className={HIDE.book}>{t('colBook')}</TableHead>
                <TableHead className={HIDE.ip}>{t('colIp')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {journal.isPending && <TableSkeletonRows columns={SKELETON_COLS} />}
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <time dateTime={row.createdAt} className="text-sm tabular-nums">
                      {format.dateTime(new Date(row.createdAt), {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </TableCell>
                  <TableCell className={HIDE.librarian}>
                    <TableText value={row.librarianName} />
                  </TableCell>
                  <TableCell>
                    <TableText value={row.readerName} />
                  </TableCell>
                  <TableCell className={HIDE.book}>
                    <TableText value={row.bookTitle} />
                  </TableCell>
                  <TableCell className={HIDE.ip}>
                    {row.ip ? <span className="font-mono text-xs">{row.ip}</span> : <TableEmpty />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
      )}
    </div>
  )
}
