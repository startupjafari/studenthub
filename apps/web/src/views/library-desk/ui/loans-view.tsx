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
  Skeleton,
  TablePagination,
} from '../../../shared/ui'
import { LoanDueBadge, fetchLoans, libraryKeys } from '../../../entities/library'

// Выдачи вуза (Фаза 20.4–20.5): на руках, просроченные, закрытые, все. Строка — книга,
// экземпляр, читатель, срок; действия над выдачей (возврат, продление, утеря, отмена,
// удостоверение) подставляет вызывающий через `actions`.

const PAGE_SIZES = [20, 50, 100] as const
const DEBOUNCE_MS = 250

type Filter = 'open' | 'overdue' | 'closed' | 'all'

export interface LoansViewProps {
  title: string
  subtitle?: string
  headerTabs?: ReactNode
  headerActions?: ReactNode
  /** Действия над выдачей в строке (у библиотекаря); нет — только просмотр. */
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
  const total = loans.data?.total ?? 0

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader title={title} subtitle={subtitle} tabs={headerTabs} actions={headerActions} />
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
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
        <div className="relative w-full md:ml-auto md:w-72">
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
      </div>

      {loans.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : loans.isError ? (
        <EmptyState
          icon={<BookOpen className="size-6" aria-hidden />}
          title={t('loansLoadError')}
          action={
            <Button type="button" variant="outline" onClick={() => void loans.refetch()}>
              {t('retry')}
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-6" aria-hidden />}
          title={debounced ? t('nothingFound') : t('noLoans')}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {items.map((loan) => (
              <li key={loan.id}>
                <Card className="flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate font-semibold">{loan.book.title}</span>
                    <span className="truncate text-sm text-muted-foreground">
                      {[
                        t('inventoryShort', { number: loan.copy.inventoryNumber }),
                        loan.reader.name,
                        loan.reader.group,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('issuedOn', {
                        date: format.dateTime(new Date(loan.issuedAt), {
                          day: 'numeric',
                          month: 'short',
                        }),
                        name: loan.issuedBy ?? '—',
                      })}
                      {loan.renewals > 0 ? ` · ${t('renewedTimes', { count: loan.renewals })}` : ''}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {loan.disputedAt && loan.status === 'OPEN' && (
                      <Badge variant="warning">{t('disputed')}</Badge>
                    )}
                    <LoanDueBadge loan={loan} />
                  </div>
                  {actions && loan.status === 'OPEN' && (
                    <div className="flex items-center gap-1">{actions(loan)}</div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
          <Card className="gap-0 py-0">
            <TablePagination
              page={page}
              total={total}
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
