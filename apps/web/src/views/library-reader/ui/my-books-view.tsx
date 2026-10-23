'use client'

import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useFormatter, useTranslations } from 'next-intl'
import { BookOpen, FileCheck, TriangleAlert } from 'lucide-react'
import type { LoanItem, ReservationItem } from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SectionPanel,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import {
  BookCover,
  LoanDueBadge,
  ReservationBadge,
  cancelMyReservationRequest,
  disputeLoanRequest,
  fetchMyLoans,
  fetchMyReservations,
  libraryKeys,
} from '../../../entities/library'
import { useReaderErrors } from '../lib/reader-errors'
import { LibraryReaderTabs } from './library-reader-tabs'

// «Мои книги» студента (Фаза 20.9): что на руках и до какого срока, брони — готовые и в
// очереди, история. Выдачу, записанную по ошибке, читатель отмечает «Это не я» — решает
// библиотекарь.

export function MyBooksView() {
  const t = useTranslations('LibraryReader')
  const loans = useQuery({ queryKey: libraryKeys.myLoans(), queryFn: fetchMyLoans })
  const reservations = useQuery({
    queryKey: libraryKeys.myReservations(),
    queryFn: fetchMyReservations,
  })

  const open = loans.data?.filter((l) => l.status === 'OPEN') ?? []
  const closed = loans.data?.filter((l) => l.status !== 'OPEN') ?? []
  const active =
    reservations.data?.filter((r) => r.status === 'READY' || r.status === 'QUEUED') ?? []
  const overdue = open.filter((l) => l.overdue).length

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title={t('title')}
        subtitle={t('mineSubtitle')}
        tabs={<LibraryReaderTabs />}
        actions={
          <Button asChild variant="outline" size="md">
            <Link href="/my-books/clearance">
              <FileCheck className="size-4" aria-hidden />
              {t('clearanceAction')}
            </Link>
          </Button>
        }
      />

      {overdue > 0 && (
        <Card className="flex-row items-start gap-3 border-destructive/30 bg-destructive/5 p-4">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <p className="text-sm">{t('overdueBanner', { count: overdue })}</p>
        </Card>
      )}

      <SectionPanel title={t('onHands')} subtitle={t('onHandsSubtitle')}>
        {loans.isPending ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : loans.isError ? (
          <p className="text-sm text-destructive">{t('loadError')}</p>
        ) : open.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="size-6" aria-hidden />}
            title={t('noLoans')}
            action={
              <Button asChild variant="outline">
                <Link href="/books">{t('toCatalog')}</Link>
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {open.map((loan) => (
              <li key={loan.id}>
                <LoanRow loan={loan} />
              </li>
            ))}
          </ul>
        )}
      </SectionPanel>

      <SectionPanel title={t('reservations')} subtitle={t('reservationsSubtitle')}>
        {reservations.isPending ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : reservations.isError ? (
          <p className="text-sm text-destructive">{t('loadError')}</p>
        ) : active.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noReservations')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {active.map((r) => (
              <li key={r.id}>
                <ReservationRow reservation={r} />
              </li>
            ))}
          </ul>
        )}
      </SectionPanel>

      {closed.length > 0 && (
        <SectionPanel title={t('history')} subtitle={t('historySubtitle')}>
          <ul className="flex flex-col divide-y divide-border">
            {closed.map((loan) => (
              <li key={loan.id}>
                <LoanRow loan={loan} />
              </li>
            ))}
          </ul>
        </SectionPanel>
      )}
    </div>
  )
}

function LoanRow({ loan }: { loan: LoanItem }) {
  const t = useTranslations('LibraryReader')
  const format = useFormatter()
  const describe = useReaderErrors()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const dispute = useMutation({
    mutationFn: () => disputeLoanRequest(loan.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: libraryKeys.myLoans() })
      toast.success(t('disputedToast'))
    },
    onError: (e) => void toast.error(describe(e)),
  })

  async function notMe(): Promise<void> {
    const ok = await confirm({
      title: t('disputeTitle'),
      description: t('disputeDesc', { title: loan.book.title }),
      confirmLabel: t('dispute'),
    })
    if (ok) dispute.mutate()
  }

  return (
    <div className="flex items-center gap-3 py-2.5">
      <Link href={`/books/${loan.book.id}`} className="shrink-0">
        <BookCover url={loan.book.coverUrl} title={loan.book.title} className="w-10" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link href={`/books/${loan.book.id}`} className="truncate font-medium hover:underline">
          {loan.book.title}
        </Link>
        <span className="truncate text-xs text-muted-foreground">
          {t('issuedOn', {
            date: format.dateTime(new Date(loan.issuedAt), { day: 'numeric', month: 'short' }),
            number: loan.copy.inventoryNumber,
          })}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
        <LoanDueBadge loan={loan} />
        {loan.status === 'OPEN' &&
          (loan.disputedAt ? (
            <Badge variant="warning">{t('disputed')}</Badge>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={dispute.isPending}
              onClick={() => void notMe()}
            >
              {t('dispute')}
            </Button>
          ))}
      </div>
    </div>
  )
}

function ReservationRow({ reservation: r }: { reservation: ReservationItem }) {
  const t = useTranslations('LibraryReader')
  const describe = useReaderErrors()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const cancelMut = useMutation({
    mutationFn: () => cancelMyReservationRequest(r.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: libraryKeys.all })
      toast.success(t('cancelledToast'))
    },
    onError: (e) => void toast.error(describe(e)),
  })

  async function cancel(): Promise<void> {
    const ok = await confirm({
      title: t('cancelTitle'),
      description: t('cancelDesc', { title: r.book.title }),
      confirmLabel: t('cancel'),
      destructive: true,
    })
    if (ok) cancelMut.mutate()
  }

  return (
    <div className="flex items-center gap-3 py-2.5">
      <Link href={`/books/${r.book.id}`} className="shrink-0">
        <BookCover url={r.book.coverUrl} title={r.book.title} className="w-10" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link href={`/books/${r.book.id}`} className="truncate font-medium hover:underline">
          {r.book.title}
        </Link>
        <span className="truncate text-xs text-muted-foreground">
          {r.status === 'READY' && r.copy
            ? t('readyAt', { number: r.copy.inventoryNumber })
            : t('queuedNote')}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
        <ReservationBadge reservation={r} />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={cancelMut.isPending}
          onClick={() => void cancel()}
        >
          {t('cancel')}
        </Button>
      </div>
    </div>
  )
}
