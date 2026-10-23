'use client'

import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { ArrowLeft, BookmarkPlus, BookX } from 'lucide-react'
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
  fetchBook,
  fetchMyLoans,
  fetchMyReservations,
  libraryKeys,
  reserveBookRequest,
  type BookCard,
} from '../../../entities/library'
import { useReaderErrors } from '../lib/reader-errors'

// Книга глазами студента (Фаза 20.9): описание, наличие и бронь. Своя бронь или книга на
// руках видны здесь же — второй раз забронировать то, что уже ждёт, не предлагаем.
export function ReaderBookView({ bookId }: { bookId: string }) {
  const t = useTranslations('LibraryReader')
  const tCat = useTranslations('LibraryCatalog')
  const describe = useReaderErrors()
  const confirm = useConfirm()
  const qc = useQueryClient()

  const book = useQuery({
    queryKey: libraryKeys.book(bookId),
    queryFn: () => fetchBook<BookCard>(bookId),
    retry: false,
  })
  const reservations = useQuery({
    queryKey: libraryKeys.myReservations(),
    queryFn: fetchMyReservations,
  })
  const loans = useQuery({ queryKey: libraryKeys.myLoans(), queryFn: fetchMyLoans })

  const reserveMut = useMutation({
    mutationFn: () => reserveBookRequest(bookId),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: libraryKeys.all })
      toast.success(r.status === 'READY' ? t('reservedReadyToast') : t('reservedQueuedToast'))
    },
    onError: (e) => void toast.error(describe(e)),
  })
  const cancelMut = useMutation({
    mutationFn: cancelMyReservationRequest,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: libraryKeys.all })
      toast.success(t('cancelledToast'))
    },
    onError: (e) => void toast.error(describe(e)),
  })

  const back = (
    <Button asChild variant="ghost" size="md">
      <Link href="/books">
        <ArrowLeft className="size-4" aria-hidden />
        {t('backToCatalog')}
      </Link>
    </Button>
  )

  if (book.isPending) {
    return (
      <div className="flex w-full flex-col gap-6">
        <Skeleton className="h-10 w-64 rounded-lg" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    )
  }
  if (book.isError) {
    return (
      <EmptyState
        icon={<BookX className="size-6" aria-hidden />}
        title={describe(book.error)}
        action={back}
      />
    )
  }

  const b = book.data
  const mine = reservations.data?.find(
    (r) => r.book.id === bookId && (r.status === 'READY' || r.status === 'QUEUED'),
  )
  const onHands = loans.data?.find((l) => l.book.id === bookId && l.status === 'OPEN')
  const { available, total } = b.availability
  const facts = [
    b.isbn ? { label: t('isbn'), value: b.isbn } : null,
    b.publisher ? { label: tCat('fieldPublisher'), value: b.publisher } : null,
    b.year ? { label: tCat('fieldYear'), value: String(b.year) } : null,
    b.section ? { label: tCat('section'), value: b.section } : null,
  ].filter((f): f is { label: string; value: string } => f !== null)

  async function cancel(id: string): Promise<void> {
    const ok = await confirm({
      title: t('cancelTitle'),
      description: t('cancelDesc', { title: b.title }),
      confirmLabel: t('cancel'),
      destructive: true,
    })
    if (ok) cancelMut.mutate(id)
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title={b.title} subtitle={b.authors || undefined} actions={back} />
      <Card className="flex-col gap-4 p-4 sm:flex-row">
        <BookCover url={b.coverUrl} title={b.title} className="w-28 self-start sm:w-36" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {total === 0 ? (
              <Badge variant="outline">{tCat('noCopies')}</Badge>
            ) : available > 0 ? (
              <Badge variant="success">{tCat('availableOf', { available, total })}</Badge>
            ) : (
              <Badge variant="secondary">{t('allTaken')}</Badge>
            )}
            {onHands && <LoanDueBadge loan={onHands} />}
            {mine && <ReservationBadge reservation={mine} />}
          </div>
          {facts.length > 0 && (
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {facts.map((f) => (
                <div key={f.label} className="flex gap-2">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="min-w-0 truncate">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="flex flex-wrap gap-2">
            {mine ? (
              <Button
                type="button"
                variant="outline"
                loading={cancelMut.isPending}
                onClick={() => void cancel(mine.id)}
              >
                {t('cancel')}
              </Button>
            ) : onHands ? null : (
              <Button
                type="button"
                disabled={total === 0}
                loading={reserveMut.isPending}
                onClick={() => reserveMut.mutate()}
              >
                <BookmarkPlus className="size-4" aria-hidden />
                {available > 0 ? t('reserve') : t('joinQueue')}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {mine?.status === 'READY'
              ? t('readyHint')
              : mine?.status === 'QUEUED'
                ? t('queuedHint')
                : onHands
                  ? t('onHandsHint')
                  : available > 0
                    ? t('reserveHint')
                    : t('queueHint')}
          </p>
        </div>
      </Card>
      {b.description && (
        <SectionPanel title={tCat('fieldDescription')} subtitle={t('descriptionSubtitle')}>
          <p className="text-sm whitespace-pre-line">{b.description}</p>
        </SectionPanel>
      )}
    </div>
  )
}
