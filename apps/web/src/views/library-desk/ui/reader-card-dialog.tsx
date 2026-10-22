'use client'

import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { ShieldCheck } from 'lucide-react'
import type { LoanItem } from '@studenthub/shared-schemas'
import { Button, EmptyState, Modal, Skeleton } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { ReaderCard, fetchLoanReader, libraryKeys } from '../../../entities/library'
import { useDeskErrors } from '../lib/desk-errors'

// Удостоверение читателя по открытой выдаче (Фаза 20.6). Каждое открытие — строка журнала
// на сервере, поэтому карточку не кэшируем: закрыл окно — данные ушли из памяти.
export function ReaderCardDialog({ loan, onClose }: { loan: LoanItem; onClose: () => void }) {
  const t = useTranslations('LibraryDesk')
  const tCommon = useTranslations('Common')
  const format = useFormatter()
  const describe = useDeskErrors()
  const card = useQuery({
    queryKey: libraryKeys.loanReader(loan.id),
    queryFn: () => fetchLoanReader(loan.id),
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  })

  return (
    <Modal onClose={onClose} title={t('readerCardTitle')} size="md">
      {card.isPending ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : card.isError ? (
        <EmptyState
          title={
            toApiError(card.error).code === 'FORBIDDEN'
              ? t('readerCardClosed')
              : describe(card.error)
          }
          action={
            <Button type="button" variant="outline" onClick={onClose}>
              {tCommon('close')}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          <ReaderCard reader={card.data.reader} />
          <p className="text-sm">
            {t('readerCardLoan', {
              title: card.data.loan.bookTitle,
              number: card.data.loan.inventoryNumber,
              date: format.dateTime(new Date(`${card.data.loan.dueDate}T00:00:00`), {
                day: 'numeric',
                month: 'long',
              }),
            })}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0" aria-hidden />
            {t('readerCardLogged')}
          </p>
        </div>
      )}
    </Modal>
  )
}
