'use client'

import { useFormatter, useTranslations } from 'next-intl'
import type { LoanItem } from '@studenthub/shared-schemas'
import { Badge } from '../../../shared/ui'
import { isLostDebt } from '../lib/loan-debt'

/**
 * Срок выдачи: «до 5 нояб.», просрочено — красным, закрытые — статусом. Утерянная — красным,
 * пока долг не погашен: это такой же долг, как просрочка.
 */
export function LoanDueBadge({ loan }: { loan: LoanItem }) {
  const t = useTranslations('LibraryDesk')
  const format = useFormatter()
  // Дата срока приходит строкой «ГГГГ-ММ-ДД» по часам вуза — показываем её, а не момент.
  const [y, m, d] = loan.dueDate.split('-').map(Number) as [number, number, number]
  const date = format.dateTime(new Date(y, m - 1, d), { day: 'numeric', month: 'short' })
  if (loan.status === 'RETURNED') return <Badge variant="secondary">{t('statusReturned')}</Badge>
  if (loan.status === 'LOST') {
    return isLostDebt(loan) ? (
      <Badge variant="destructive">{t('statusLostDebt')}</Badge>
    ) : (
      <Badge variant="secondary">{t('statusLostSettled')}</Badge>
    )
  }
  if (loan.status === 'CANCELLED') return <Badge variant="outline">{t('statusCancelled')}</Badge>
  if (loan.overdue) return <Badge variant="destructive">{t('overdueSince', { date })}</Badge>
  return <Badge variant="info">{t('dueUntil', { date })}</Badge>
}
