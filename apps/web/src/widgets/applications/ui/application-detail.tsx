'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import {
  ApplicationStatusBadge,
  applicationKeys,
  fetchApplication,
  cancelApplicationRequest,
  resubmitApplicationRequest,
  pickLocale,
  type TimelineEvent,
  type ApplicationDocumentItem,
} from '../../../entities/application-service'
import { STUDENT_CANCELLABLE_STATUSES } from '@studenthub/shared-schemas'
import { Button, Card, Skeleton, EmptyState, useConfirm } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { DocumentChecklist } from './document-checklist'

export function ApplicationDetail({
  id,
  onBack,
  onContinueDraft,
}: {
  id: string
  onBack: () => void
  onContinueDraft: (id: string) => void
}) {
  const t = useTranslations('Applications')
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()

  const q = useQuery({ queryKey: applicationKeys.detail(id), queryFn: () => fetchApplication(id) })
  const cancelMut = useMutation({
    mutationFn: () => cancelApplicationRequest(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: applicationKeys.all })
      toast.success(t('cancelledToast'))
      onBack()
    },
    onError: () => toast.error(t('loadError')),
  })
  const resubmitMut = useMutation({
    mutationFn: () => resubmitApplicationRequest(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: applicationKeys.all })
      void q.refetch()
    },
    onError: () => toast.error(t('loadError')),
  })

  const app = q.data
  const docs: ApplicationDocumentItem[] = app?.documents ?? []
  const editableDocs = app?.status === 'NEEDS_CORRECTION'
  const replacementPending = docs.some((d) => d.status === 'REPLACEMENT_REQUIRED')
  const serviceName = app
    ? pickLocale(app.service as unknown as Record<string, unknown>, 'name', locale)
    : ''
  const cancellable = app ? STUDENT_CANCELLABLE_STATUSES.includes(app.status) : false
  const isDraft = app?.status === 'DRAFT'

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label={t('backBtn')}>
          <ArrowLeft className="size-5" aria-hidden />
        </Button>
        <h2 className="truncate text-lg font-semibold">{serviceName || t('title')}</h2>
      </div>

      {q.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : q.isError || !app ? (
        <EmptyState
          icon={<AlertTriangle className="size-6" aria-hidden />}
          title={t('loadError')}
          action={
            <Button variant="outline" onClick={() => q.refetch()}>
              {t('retry')}
            </Button>
          }
        />
      ) : (
        <>
          <Card className="flex flex-col gap-4 p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm text-muted-foreground">
                {app.number ?? t('status2_DRAFT')}
              </span>
              <ApplicationStatusBadge status={app.status} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {app.deliveryType && (
                <Row label={t('deliveryTitle')} value={t(`delivery_${app.deliveryType}`)} />
              )}
              {app.submittedAt && (
                <Row
                  label={t('submittedAtLabel')}
                  value={new Date(app.submittedAt).toLocaleString(locale)}
                />
              )}
              {app.dueAt &&
                !['ISSUED', 'DELIVERED', 'REJECTED', 'CANCELLED'].includes(app.status) && (
                  <Row
                    label={t('expectedReady')}
                    value={new Date(app.dueAt).toLocaleString(locale)}
                  />
                )}
              {app.status === 'REJECTED' && app.rejectionReason && (
                <Row label={t('status2_REJECTED')} value={app.rejectionReason} />
              )}
            </div>
          </Card>

          {app.status === 'NEEDS_CORRECTION' && (
            <Card className="flex items-start gap-3 border-amber-500/40 bg-amber-500/5 p-4">
              <AlertTriangle
                className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400"
                aria-hidden
              />
              <div className="text-sm">
                <p className="font-semibold text-amber-700 dark:text-amber-300">
                  {t('actionNeeded')}
                </p>
              </div>
            </Card>
          )}

          {(app.status === 'READY_FOR_PICKUP' || app.status === 'ISSUED') &&
            (app.pickupLocation || app.pickupInstructions) && (
              <Card className="flex flex-col gap-1.5 p-4">
                <h3 className="text-sm font-semibold">{t('pickupTitle')}</h3>
                {app.pickupLocation && <p className="text-sm">{app.pickupLocation}</p>}
                {app.pickupInstructions && (
                  <p className="text-sm text-muted-foreground">{app.pickupInstructions}</p>
                )}
              </Card>
            )}

          {/* Документы и История — рядом на широких экранах, стопкой на узких */}
          <div className={cn('grid gap-4', docs.length > 0 && 'lg:grid-cols-2')}>
            {docs.length > 0 && (
              <Card className="flex flex-col gap-3 p-4">
                <h3 className="text-sm font-semibold">{t('documentsTitle')}</h3>
                <DocumentChecklist
                  appId={app.id}
                  requirements={docs.map((d) => ({
                    id: d.requirement.id,
                    documentType: null,
                    titleRu: d.requirement.titleRu,
                    titleKk: d.requirement.titleKk,
                    titleEn: d.requirement.titleEn,
                    required: d.requirement.required,
                  }))}
                  documents={docs}
                  editable={editableDocs}
                  locale={locale}
                  onChanged={() => void q.refetch()}
                />
              </Card>
            )}

            <Card className="flex flex-col gap-3 p-4">
              <h3 className="text-sm font-semibold">{t('timelineTitle')}</h3>
              <Timeline events={app.events} />
            </Card>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            {isDraft && (
              <Button className="w-full sm:w-auto" onClick={() => onContinueDraft(app.id)}>
                {t('continueDraft')}
              </Button>
            )}
            {editableDocs && !replacementPending && (
              <Button
                className="w-full sm:w-auto"
                loading={resubmitMut.isPending}
                onClick={() => resubmitMut.mutate()}
              >
                {t('resubmit')}
              </Button>
            )}
            {cancellable && (
              <Button
                variant="outline"
                className="w-full text-destructive hover:text-destructive sm:w-auto"
                loading={cancelMut.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: t('cancelApplication'),
                    description: t('cancelConfirm'),
                    destructive: true,
                  })
                  if (ok) cancelMut.mutate()
                }}
              >
                {t('cancelApplication')}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// Человеческий timeline (§19): понятные события, не «NEW → PROCESSING».
function Timeline({ events }: { events: TimelineEvent[] }) {
  const t = useTranslations('Applications')
  const locale = useLocale()
  if (!events.length) return null
  return (
    <ol className="flex flex-col gap-4">
      {events.map((e) => {
        const key = `event_${e.action}`
        const label = t.has(key) ? t(key) : e.toStatus ? t(`status2_${e.toStatus}`) : e.action
        return (
          <li key={e.id} className="flex gap-3">
            <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" aria-hidden />
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(e.createdAt).toLocaleString(locale)}
              </span>
              {e.comment && (
                <span className="mt-0.5 text-sm text-muted-foreground">{e.comment}</span>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}
