'use client'

import { useFormatter, useTranslations } from 'next-intl'
import type { ReservationItem } from '@studenthub/shared-schemas'
import { Badge } from '../../../shared/ui'

/** Бронь: готова до такого-то дня, место в очереди или чем закончилась. */
export function ReservationBadge({ reservation }: { reservation: ReservationItem }) {
  const t = useTranslations('LibraryDesk')
  const format = useFormatter()
  switch (reservation.status) {
    case 'READY': {
      if (!reservation.holdDate) return <Badge variant="success">{t('resReady')}</Badge>
      // День приходит строкой «ГГГГ-ММ-ДД» по часам вуза — показываем его, а не момент.
      const [y, m, d] = reservation.holdDate.split('-').map(Number) as [number, number, number]
      const date = format.dateTime(new Date(y, m - 1, d), { day: 'numeric', month: 'short' })
      return <Badge variant="success">{t('resReadyUntil', { date })}</Badge>
    }
    case 'QUEUED':
      return (
        <Badge variant="info">
          {reservation.position
            ? t('resQueuePosition', { position: reservation.position })
            : t('resQueued')}
        </Badge>
      )
    case 'FULFILLED':
      return <Badge variant="secondary">{t('resFulfilled')}</Badge>
    case 'EXPIRED':
      return <Badge variant="outline">{t('resExpired')}</Badge>
    case 'CANCELLED':
      return <Badge variant="outline">{t('resCancelled')}</Badge>
  }
}
