'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  BookCopy,
  BookOpen,
  BookmarkCheck,
  CircleAlert,
  ListChecks,
  TrendingUp,
  UsersRound,
} from 'lucide-react'
import { POPULAR_PERIODS } from '@studenthub/shared-schemas'
import { MetricTile, PageHeader, SectionPanel, SegmentedTabs, Skeleton } from '../../../shared/ui'
import {
  BookCover,
  LoanDueBadge,
  fetchLibrarySummary,
  fetchLoans,
  fetchPopularBooks,
  libraryKeys,
} from '../../../entities/library'

// Отчёты библиотеки (Фаза 20.12): фонд, выдачи и должники, брони, популярное за период.
// Один экран у библиотекаря и у админа вуза; ссылки ведут туда, где с данными можно работать.

// Вкладки периода работают со строками — число дней получаем при запросе.
type Period = `${(typeof POPULAR_PERIODS)[number]}`
const OVERDUE_PREVIEW = 10

export interface ReportsViewProps {
  headerTabs?: ReactNode
  /** Куда ведут «все должники» и книги: у библиотекаря — его разделы, у админа — свои. */
  loansHref?: string
  catalogHref: string
}

export function ReportsView({ headerTabs, loansHref, catalogHref }: ReportsViewProps) {
  const t = useTranslations('LibraryReports')
  const [days, setDays] = useState<Period>('90')
  const summary = useQuery({ queryKey: libraryKeys.summary(), queryFn: fetchLibrarySummary })
  const popular = useQuery({
    queryKey: libraryKeys.popular(Number(days)),
    queryFn: () => fetchPopularBooks(Number(days)),
  })
  const overdueParams = { filter: 'overdue' as const, page: 1, limit: OVERDUE_PREVIEW }
  const overdue = useQuery({
    queryKey: libraryKeys.loans(overdueParams),
    queryFn: () => fetchLoans(overdueParams),
  })
  const s = summary.data
  const loading = summary.isPending

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader title={t('title')} subtitle={t('subtitle')} tabs={headerTabs} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          icon={BookOpen}
          label={t('books')}
          value={s?.books ?? null}
          hint={s ? t('copiesHint', { count: s.copies.total }) : undefined}
          loading={loading}
          index={0}
        />
        <MetricTile
          icon={BookCopy}
          label={t('onLoan')}
          value={s?.loans.open ?? null}
          hint={s ? t('onShelfHint', { count: s.copies.available }) : undefined}
          loading={loading}
          index={1}
          href={loansHref}
        />
        <MetricTile
          icon={CircleAlert}
          tone="text-destructive"
          label={t('overdue')}
          value={s?.loans.overdue ?? null}
          valueTone={s && s.loans.overdue > 0 ? 'text-destructive' : undefined}
          hint={s ? t('debtorsHint', { count: s.readers.debtors }) : undefined}
          loading={loading}
          index={2}
        />
        <MetricTile
          icon={BookmarkCheck}
          label={t('reservations')}
          value={s ? s.reservations.ready + s.reservations.queued : null}
          hint={
            s
              ? t('reservationsHint', {
                  ready: s.reservations.ready,
                  queued: s.reservations.queued,
                })
              : undefined
          }
          loading={loading}
          index={3}
        />
        <MetricTile
          icon={ListChecks}
          label={t('issued30')}
          value={s?.loans.issuedLast30 ?? null}
          hint={s ? t('returned30Hint', { count: s.loans.returnedLast30 }) : undefined}
          loading={loading}
          index={4}
        />
        <MetricTile
          icon={UsersRound}
          label={t('readers')}
          value={s?.readers.withLoans ?? null}
          hint={t('readersHint')}
          loading={loading}
          index={5}
        />
        <MetricTile
          icon={CircleAlert}
          tone="text-muted-foreground"
          label={t('withdrawn')}
          value={s ? s.copies.lost + s.copies.writtenOff : null}
          hint={
            s ? t('withdrawnHint', { lost: s.copies.lost, off: s.copies.writtenOff }) : undefined
          }
          loading={loading}
          index={6}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionPanel
          title={t('debtorsTitle')}
          subtitle={t('debtorsSubtitle')}
          actions={
            loansHref ? (
              <Link href={loansHref} className="text-sm font-medium text-primary hover:underline">
                {t('allLoans')}
              </Link>
            ) : undefined
          }
        >
          {overdue.isPending ? (
            <Skeleton className="h-32 w-full rounded-xl" />
          ) : (overdue.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noDebtors')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {overdue.data?.items.map((loan) => (
                <li key={loan.id} className="flex items-center gap-3 py-2">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{loan.reader.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {[loan.reader.group, loan.book.title].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <LoanDueBadge loan={loan} />
                </li>
              ))}
            </ul>
          )}
        </SectionPanel>

        <SectionPanel
          title={t('popularTitle')}
          subtitle={t('popularSubtitle')}
          actions={
            <SegmentedTabs<Period>
              value={days}
              aria-label={t('period')}
              onChange={setDays}
              items={POPULAR_PERIODS.map((p) => ({
                value: `${p}` as Period,
                label: t('days', { count: p }),
              }))}
            />
          }
        >
          {popular.isPending ? (
            <Skeleton className="h-32 w-full rounded-xl" />
          ) : (popular.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noPopular')}</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border">
              {popular.data?.map((row, i) => (
                <li key={row.book.id}>
                  <Link
                    href={`${catalogHref}/${row.book.id}`}
                    className="flex items-center gap-3 py-2 hover:bg-muted/40"
                  >
                    <span className="w-6 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
                      {i + 1}
                    </span>
                    <BookCover url={row.book.coverUrl} title={row.book.title} className="w-8" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{row.book.title}</span>
                      {row.book.authors && (
                        <span className="truncate text-xs text-muted-foreground">
                          {row.book.authors}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-1 text-sm tabular-nums">
                      <TrendingUp className="size-4 text-muted-foreground" aria-hidden />
                      {t('loansCount', { count: row.loans })}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </SectionPanel>
      </div>
    </div>
  )
}
