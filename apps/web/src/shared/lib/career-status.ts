'use client'

import { useTranslations } from 'next-intl'
import type { CareerApplicationStatus } from '@studenthub/shared-schemas'

/**
 * Подписи и тон статусов отклика — одни и те же у студента и у компании.
 *
 * Вынесены сюда, потому что нужны в двух слайсах (views/career и views/employer), а
 * импорт между слайсами одного слоя запрещён (FRONTEND_RULES §2.1). Ключи перечислены
 * явно: сборка вида t(`status.${x}`) запрещена (§10).
 */
export type StatusTone = 'default' | 'secondary' | 'outline' | 'destructive'

export function useApplicationStatusLabels(): {
  label: Record<CareerApplicationStatus, string>
  tone: Record<CareerApplicationStatus, StatusTone>
} {
  const t = useTranslations('CareerApplications')
  return {
    label: {
      SUBMITTED: t('statusSubmitted'),
      VIEWED: t('statusViewed'),
      SHORTLISTED: t('statusShortlisted'),
      INTERVIEW: t('statusInterview'),
      OFFER: t('statusOffer'),
      HIRED: t('statusHired'),
      REJECTED: t('statusRejected'),
      WITHDRAWN: t('statusWithdrawn'),
    },
    tone: {
      SUBMITTED: 'outline',
      VIEWED: 'outline',
      SHORTLISTED: 'secondary',
      INTERVIEW: 'secondary',
      OFFER: 'default',
      HIRED: 'default',
      REJECTED: 'destructive',
      WITHDRAWN: 'outline',
    },
  }
}
