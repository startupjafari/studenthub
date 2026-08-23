'use client'

import { useTranslations } from 'next-intl'
import type { ApplicationServiceStatus } from '@studenthub/shared-schemas'
import { cn } from '../../../shared/lib/utils'

// Единый источник цветов статуса заявки (§46) — не дублировать маппинг по компонентам.
const TONE: Record<ApplicationServiceStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SUBMITTED: 'bg-primary/10 text-primary',
  IN_REVIEW: 'bg-primary/10 text-primary',
  RESUBMITTED: 'bg-primary/10 text-primary',
  NEEDS_CORRECTION: 'bg-warning/15 text-warning',
  IN_PREPARATION: 'bg-info/15 text-info',
  READY: 'bg-success/15 text-success',
  READY_FOR_PICKUP: 'bg-success/15 text-success',
  DELIVERED: 'bg-success/15 text-success',
  ISSUED: 'bg-success/15 text-success',
  REJECTED: 'bg-destructive/10 text-destructive',
  CANCELLED: 'bg-muted text-muted-foreground',
}

export function ApplicationStatusBadge({
  status,
  className,
}: {
  status: ApplicationServiceStatus
  className?: string
}) {
  const t = useTranslations('Applications')
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE[status],
        className,
      )}
    >
      {t(`status2_${status}`)}
    </span>
  )
}
