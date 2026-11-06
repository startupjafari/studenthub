'use client'

import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { Modal, Skeleton } from '../../../shared/ui'
import { LoanDueBadge, fetchLoans, libraryKeys, type BookCopyItem } from '../../../entities/library'

const HISTORY_LIMIT = 100

/** История экземпляра (Фаза 20.12): все его выдачи — кто, когда, чем закончилась. */
export function CopyHistoryModal({ copy, onClose }: { copy: BookCopyItem; onClose: () => void }) {
  const t = useTranslations('LibraryCatalog')
  const tDesk = useTranslations('LibraryDesk')
  const format = useFormatter()
  const params = { copyId: copy.id, filter: 'all' as const, page: 1, limit: HISTORY_LIMIT }
  const loans = useQuery({ queryKey: libraryKeys.loans(params), queryFn: () => fetchLoans(params) })
  const day = (iso: string): string =>
    format.dateTime(new Date(iso), { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <Modal onClose={onClose} title={t('historyTitle', { number: copy.inventoryNumber })} size="lg">
      {loans.isPending ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : loans.isError ? (
        <p className="text-sm text-destructive">{t('loadError')}</p>
      ) : (loans.data?.items.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">{t('historyEmpty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {loans.data?.items.map((loan) => (
            <li key={loan.id} className="flex items-center gap-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">
                  {[loan.reader.name, loan.reader.group].filter(Boolean).join(' · ')}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {[
                    t('historyIssued', { date: day(loan.issuedAt) }),
                    loan.returnedAt ? t('historyReturned', { date: day(loan.returnedAt) }) : null,
                    loan.cancelReason
                      ? tDesk('cancelReasonShort', { reason: loan.cancelReason })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <LoanDueBadge loan={loan} />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
