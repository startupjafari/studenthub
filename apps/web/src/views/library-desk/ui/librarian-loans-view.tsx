'use client'

import { useTranslations } from 'next-intl'
import { canCancelReturn, isLostDebt } from '../../../entities/library'
import { CancelReturnAction } from './cancel-return-action'
import { LoanActions } from './loan-actions'
import { LostDebtAction } from './lost-debt-action'
import { LoansView } from './loans-view'

// Выдачи у библиотекаря (Фаза 20.4–20.5): список с действиями над открытой выдачей и
// отметкой «долг погашен» у утерянной книги, «Отменить возврат» у недавно возвращённой.
export function LibrarianLoansView() {
  const t = useTranslations('LibraryDesk')
  return (
    <LoansView
      title={t('loansTitle')}
      subtitle={t('loansSubtitle')}
      actions={(loan) =>
        loan.status === 'OPEN' ? (
          <LoanActions loan={loan} />
        ) : isLostDebt(loan) ? (
          <LostDebtAction loan={loan} />
        ) : canCancelReturn(loan) ? (
          <CancelReturnAction loan={loan} variant="menu" />
        ) : null
      }
    />
  )
}
