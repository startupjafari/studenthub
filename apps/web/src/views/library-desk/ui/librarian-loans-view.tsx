'use client'

import { useTranslations } from 'next-intl'
import { LoanActions } from './loan-actions'
import { LoansView } from './loans-view'

// Выдачи у библиотекаря (Фаза 20.4–20.5): список с действиями над открытой выдачей.
export function LibrarianLoansView() {
  const t = useTranslations('LibraryDesk')
  return (
    <LoansView
      title={t('loansTitle')}
      subtitle={t('loansSubtitle')}
      actions={(loan) => <LoanActions loan={loan} />}
    />
  )
}
