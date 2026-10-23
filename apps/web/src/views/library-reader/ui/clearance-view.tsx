'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { ArrowLeft, BadgeCheck, Printer, TriangleAlert } from 'lucide-react'
import type { LibraryClearance } from '@studenthub/shared-schemas'
import { Button, Card, EmptyState, PageHeader, Skeleton } from '../../../shared/ui'
import { LoanDueBadge, fetchClearance, isLostDebt, libraryKeys } from '../../../entities/library'

// Справка «задолженностей в библиотеке нет» (Фаза 20.11): на момент запроса, для обходного
// листа при выпуске или переводе. Есть книги на руках — вместо справки список того, что
// вернуть, а утерянную книгу без погашения — заменить или возместить. Печатается только лист
// справки (правила @media print в globals.css).
export function ClearanceView() {
  const t = useTranslations('LibraryReader')
  const format = useFormatter()
  const clearance = useQuery({
    queryKey: libraryKeys.clearance(),
    queryFn: fetchClearance,
    staleTime: 0,
  })

  const back = (
    <Button asChild variant="ghost" size="md">
      <Link href="/my-books">
        <ArrowLeft className="size-4" aria-hidden />
        {t('tabMine')}
      </Link>
    </Button>
  )

  if (clearance.isPending) return <Skeleton className="h-64 w-full rounded-xl" />
  if (clearance.isError) {
    return (
      <EmptyState
        icon={<TriangleAlert className="size-6" aria-hidden />}
        title={t('loadError')}
        action={back}
      />
    )
  }
  const c = clearance.data
  const checked = format.dateTime(new Date(c.checkedAt), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title={t('clearanceTitle')}
        subtitle={t('clearanceSubtitle')}
        actions={
          <>
            {back}
            {c.clear && (
              <Button type="button" size="md" onClick={() => window.print()}>
                <Printer className="size-4" aria-hidden />
                {t('print')}
              </Button>
            )}
          </>
        }
      />
      {c.clear ? (
        <Card className="flex-row items-start gap-3 border-success/40 bg-success/10 p-4">
          <BadgeCheck className="mt-0.5 size-6 shrink-0 text-success" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-semibold">{t('clearTitle')}</p>
            <p className="text-sm">{t('clearBody', { name: c.reader.name, date: checked })}</p>
          </div>
        </Card>
      ) : (
        <Card className="flex-col gap-3 border-destructive/30 bg-destructive/5 p-4">
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="size-5 shrink-0 text-destructive" aria-hidden />
            {t('notClearTitle', { count: c.loans.length })}
          </p>
          <ul className="flex flex-col divide-y divide-border">
            {c.loans.map((loan) => (
              <li key={loan.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {loan.book.title}
                </span>
                <LoanDueBadge loan={loan} />
              </li>
            ))}
          </ul>
          {c.loans.some(isLostDebt) && (
            <p className="text-sm text-muted-foreground">{t('lostHint')}</p>
          )}
        </Card>
      )}
      {c.clear && <ClearanceSheet clearance={c} checked={checked} />}
    </div>
  )
}

/** Лист справки для печати — на экране скрыт. */
function ClearanceSheet({
  clearance: c,
  checked,
}: {
  clearance: LibraryClearance
  checked: string
}) {
  const t = useTranslations('LibraryReader')
  const details = [
    c.reader.faculty ? `${t('sheetFaculty')}: ${c.reader.faculty}` : null,
    c.reader.group ? `${t('sheetGroup')}: ${c.reader.group}` : null,
    c.reader.studentCardNumber ? `${t('sheetCard')}: ${c.reader.studentCardNumber}` : null,
  ].filter(Boolean)
  return (
    <div className="sh-print-root">
      <article className="sh-print-page mx-auto flex max-w-[170mm] flex-col gap-6 p-[10mm] text-black">
        <p className="text-center text-sm">{c.university}</p>
        <h1 className="text-center text-xl font-bold uppercase">{t('sheetTitle')}</h1>
        <p className="text-base leading-relaxed">{t('sheetBody', { name: c.reader.name })}</p>
        {details.length > 0 && <p className="text-sm">{details.join(' · ')}</p>}
        <p className="text-sm">{t('sheetChecked', { date: checked })}</p>
        <p className="mt-10 text-sm">{t('sheetSignature')}</p>
      </article>
    </div>
  )
}
