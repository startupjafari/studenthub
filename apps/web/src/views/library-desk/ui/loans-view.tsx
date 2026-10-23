'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { BookOpen, Search } from 'lucide-react'
import type { LoanItem } from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  SegmentedTabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  TableSkeletonRows,
  TableText,
} from '../../../shared/ui'
import { LoanDueBadge, fetchLoans, libraryKeys } from '../../../entities/library'

// Выдачи вуза (Фаза 20.4–20.5): на руках, просроченные, закрытые, все. Таблица во всю
// высоту (DESIGN_SYSTEM §10.7): фильтр — в шапке рядом с поиском, а не полосой над списком.
// Действия над выдачей (возврат, продление, утеря, отмена, удостоверение) подставляет
// вызывающий через `actions`.

const PAGE_SIZES = [20, 50, 100] as const
const DEBOUNCE_MS = 250

type Filter = 'open' | 'overdue' | 'closed' | 'all'

// Книга · читатель · выдана · срок · действия. На телефоне — книга, срок и действия.
const COLS = ['32%', '28%', '14%', 'calc(26% - 3.5rem)', '3.5rem'] as const
const COLS_NARROW = ['55%', '0', '0', 'calc(45% - 3.5rem)', '3.5rem'] as const
const HIDE = { reader: 'hidden md:table-cell', issued: 'hidden md:table-cell' } as const
const SKELETON_COLS = [undefined, HIDE.reader, HIDE.issued, undefined, undefined]

export interface LoansViewProps {
  title: string
  subtitle?: string
  headerTabs?: ReactNode
  headerActions?: ReactNode
  /**
   * Действия над выдачей в строке (у библиотекаря); нет — только просмотр. Вызывается для
   * каждой строки: что доступно (открытой, недавно возвращённой), решает вызывающий.
   */
  actions?: (loan: LoanItem) => ReactNode
}

export function LoansView({ title, subtitle, headerTabs, headerActions, actions }: LoansViewProps) {
  const t = useTranslations('LibraryDesk')
  const format = useFormatter()
  const [filter, setFilter] = useState<Filter>('open')
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
  const loans = useQuery({
    queryKey: libraryKeys.loans(params),
    queryFn: () => fetchLoans(params),
    placeholderData: keepPreviousData,
  })
  const items = loans.data?.items ?? []
  const day = (iso: string): string =>
    format.dateTime(new Date(iso), { day: 'numeric', month: 'short' })

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6">
      <PageHeader
        title={title}
        subtitle={subtitle}
        tabs={
          <>
            {headerTabs}
            <SegmentedTabs<Filter>
              value={filter}
              aria-label={t('filter')}
              onChange={(v) => {
                setFilter(v)
                setPage(1)
              }}
              items={[
                { value: 'open', label: t('filterOpen') },
                { value: 'overdue', label: t('filterOverdue') },
                { value: 'closed', label: t('filterClosed') },
                { value: 'all', label: t('filterAll') },
              ]}
            />
          </>
        }
        actions={
          <>
            <div className="relative w-full sm:w-64">
              <Search
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                size="md"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('searchLoans')}
                aria-label={t('searchLoans')}
                className="pl-9"
              />
            </div>
            {headerActions}
          </>
        }
      />

      {loans.isError ? (
        <EmptyState
          icon={<BookOpen className="size-6" aria-hidden />}
          title={t('loansLoadError')}
          action={
            <Button type="button" variant="outline" onClick={() => void loans.refetch()}>
              {t('retry')}
            </Button>
          }
        />
      ) : items.length === 0 && !loans.isPending ? (
        <EmptyState
          icon={<BookOpen className="size-6" aria-hidden />}
          title={debounced ? t('nothingFound') : t('noLoans')}
        />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colBook')}</TableHead>
                <TableHead className={HIDE.reader}>{t('colReader')}</TableHead>
                <TableHead className={HIDE.issued}>{t('colIssued')}</TableHead>
                <TableHead>{t('colDue')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('loanActions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loans.isPending && <TableSkeletonRows columns={SKELETON_COLS} />}
              {items.map((loan) => (
                <TableRow key={loan.id}>
                  <TableCell>
                    <div className="flex min-w-0 flex-col">
                      <TableText value={loan.book.title} className="font-medium" />
                      <span className="truncate text-xs text-muted-foreground">
                        {t('inventoryShort', { number: loan.copy.inventoryNumber })}
                        {/* На телефоне колонки читателя нет — он строкой под книгой. */}
                        <span className="md:hidden"> · {loan.reader.name}</span>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className={HIDE.reader}>
                    <div className="flex min-w-0 flex-col">
                      <TableText value={loan.reader.name} />
                      <span className="truncate text-xs text-muted-foreground">
                        {[loan.reader.group, loan.reader.card ? `№ ${loan.reader.card}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className={HIDE.issued}>
                    <div className="flex min-w-0 flex-col">
                      <span className="text-sm">{day(loan.issuedAt)}</span>
                      {loan.renewals > 0 && (
                        <span className="truncate text-xs text-muted-foreground">
                          {t('renewedTimes', { count: loan.renewals })}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <LoanDueBadge loan={loan} />
                      {loan.disputedAt && loan.status === 'OPEN' && (
                        <Badge variant="warning">{t('disputed')}</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {actions && <div className="flex justify-end">{actions(loan)}</div>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            total={loans.data?.total ?? 0}
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
