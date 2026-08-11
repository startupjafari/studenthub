'use client'

import { useLocale, useTranslations } from 'next-intl'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import {
  ApplicationStatusBadge,
  pickLocale,
  type ApplicationListItem,
} from '../../../entities/application-service'
import { Card } from '../../../shared/ui'

// Карточка заявки в списке студента (mobile-first, крупная зона нажатия).
export function ApplicationCard({ app, onOpen }: { app: ApplicationListItem; onOpen: () => void }) {
  const t = useTranslations('Applications')
  const locale = useLocale()
  const serviceName = pickLocale(app.service as unknown as Record<string, unknown>, 'name', locale)
  const needsAction = app.status === 'NEEDS_CORRECTION'
  const showDue =
    app.dueAt && !['ISSUED', 'DELIVERED', 'REJECTED', 'CANCELLED'].includes(app.status)

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
      className="flex cursor-pointer items-center gap-3 p-4 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium text-muted-foreground">
            {app.number ?? t('status2_DRAFT')}
          </span>
          <ApplicationStatusBadge status={app.status} />
        </div>
        <span className="truncate font-semibold">{serviceName}</span>
        {showDue ? (
          <span className="text-xs text-muted-foreground">
            {t('expectedReady')}: {new Date(app.dueAt!).toLocaleDateString(locale)}
          </span>
        ) : (
          app.submittedAt && (
            <span className="text-xs text-muted-foreground">
              {t('submittedAtLabel')}: {new Date(app.submittedAt).toLocaleDateString(locale)}
            </span>
          )
        )}
        {needsAction && (
          <span className="mt-0.5 inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-3.5" aria-hidden />
            {t('actionNeeded')}
          </span>
        )}
      </div>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    </Card>
  )
}
