'use client'

import { useLocale, useTranslations } from 'next-intl'
import { AlertTriangle, ArrowRight, CalendarClock } from 'lucide-react'
import type { ApplicationServiceStatus } from '@studenthub/shared-schemas'
import {
  ApplicationStatusBadge,
  pickLocale,
  type ApplicationListItem,
} from '../../../entities/application-service'
import { Card } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

// Насколько заявка продвинута по маршруту (для полоски прогресса в карточке).
const STATUS_PROGRESS: Record<ApplicationServiceStatus, number> = {
  DRAFT: 6,
  SUBMITTED: 22,
  IN_REVIEW: 42,
  RESUBMITTED: 42,
  NEEDS_CORRECTION: 42,
  IN_PREPARATION: 66,
  READY: 88,
  READY_FOR_PICKUP: 88,
  ISSUED: 100,
  DELIVERED: 100,
  REJECTED: 100,
  CANCELLED: 100,
}
const FAILED: ApplicationServiceStatus[] = ['REJECTED', 'CANCELLED']
const FINISHED: ApplicationServiceStatus[] = ['ISSUED', 'DELIVERED', 'REJECTED', 'CANCELLED']

// Карточка заявки в списке студента: единая высота (для сетки), крупная зона нажатия, прогресс.
export function ApplicationCard({ app, onOpen }: { app: ApplicationListItem; onOpen: () => void }) {
  const t = useTranslations('Applications')
  const locale = useLocale()
  const serviceName = pickLocale(app.service as unknown as Record<string, unknown>, 'name', locale)
  const needsAction = app.status === 'NEEDS_CORRECTION'
  const failed = FAILED.includes(app.status)
  const isDraft = app.status === 'DRAFT'
  const showDue = app.dueAt && !FINISHED.includes(app.status)

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
      className={cn(
        'group/app relative flex h-full cursor-pointer flex-col gap-4 p-5 transition-all outline-none',
        'hover:-translate-y-0.5 hover:shadow-lg hover:ring-primary/30 focus-visible:ring-2 focus-visible:ring-ring/40',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[11px] tracking-tight text-muted-foreground">
            {app.number ?? t('status2_DRAFT')}
          </span>
          <span className="line-clamp-2 text-base leading-snug font-semibold">{serviceName}</span>
        </div>
        <ApplicationStatusBadge status={app.status} />
      </div>

      {!isDraft && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={STATUS_PROGRESS[app.status]}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={cn(
              'h-full rounded-full transition-all',
              needsAction ? 'bg-amber-500' : failed ? 'bg-muted-foreground/40' : 'bg-primary',
            )}
            style={{ width: `${STATUS_PROGRESS[app.status]}%` }}
          />
        </div>
      )}

      <div className="mt-auto flex items-end justify-between gap-2">
        <div className="min-w-0 text-xs text-muted-foreground">
          {needsAction ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              {t('actionNeeded')}
            </span>
          ) : showDue ? (
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">
                {t('expectedReady')}: {new Date(app.dueAt!).toLocaleDateString(locale)}
              </span>
            </span>
          ) : app.submittedAt ? (
            <span className="truncate">
              {t('submittedAtLabel')}: {new Date(app.submittedAt).toLocaleDateString(locale)}
            </span>
          ) : (
            <span className="truncate">{t('status2_DRAFT')}</span>
          )}
        </div>
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover/app:bg-primary group-hover/app:text-primary-foreground"
        >
          <ArrowRight className="size-4" />
        </span>
      </div>
    </Card>
  )
}
