'use client'

import { useTranslations } from 'next-intl'
import { LoansView } from './loans-view'

// Выдачи у библиотекаря (Фаза 20.4). Действия над выдачей добавляет 20.5.
export function LibrarianLoansView() {
  const t = useTranslations('LibraryDesk')
  return <LoansView title={t('loansTitle')} subtitle={t('loansSubtitle')} />
}
