'use client'

import { useLocale, useTranslations } from 'next-intl'
import { AlertTriangle, ChevronRight, FileText } from 'lucide-react'
import {
  ApplicationStatusBadge,
  pickLocale,
  type ApplicationListItem,
} from '../../../entities/application-service'
import { Card } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

const FINISHED = ['ISSUED', 'DELIVERED', 'REJECTED', 'CANCELLED']

// Строка заявки в списке студента — системный row-card (как в faculties/materials):
// ведущая иконка в скруглённом квадрате, контент, статус-бейдж и шеврон.
export function ApplicationCard({
  app,
  onOpen,
  onPrefetch,
}: {
  app: ApplicationListItem
  onOpen: () => void
  onPrefetch?: () => void
}) {
  const t = useTranslations('Applications')
  const locale = useLocale()
  const serviceName = pickLocale(app.service as unknown as Record<string, unknown>, 'name', locale)
  const needsAction = app.status === 'NEEDS_CORRECTION'
  const showDue = app.dueAt && !FINISHED.includes(app.status)

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      className="flex-row items-center gap-3 p-4 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-lg',
          needsAction
            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
            : 'bg-primary/10 text-primary',
        )}
      >
        <FileText className="size-5" aria-hidden />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-xs text-muted-foreground">
            {app.number ?? t('status2_DRAFT')}
          </span>
          <ApplicationStatusBadge status={app.status} />
        </div>
        <span className="truncate font-medium">{serviceName}</span>
        {needsAction ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            {t('actionNeeded')}
          </span>
        ) : showDue ? (
          <span className="truncate text-xs text-muted-foreground">
            {t('expectedReady')}: {new Date(app.dueAt!).toLocaleDateString(locale)}
          </span>
        ) : (
          app.submittedAt && (
            <span className="truncate text-xs text-muted-foreground">
              {t('submittedAtLabel')}: {new Date(app.submittedAt).toLocaleDateString(locale)}
            </span>
          )
        )}
      </div>

      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    </Card>
  )
}
