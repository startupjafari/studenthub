'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Eye, Check, RefreshCw } from 'lucide-react'
import {
  ApplicationStatusBadge,
  applicationKeys,
  fetchApplication,
  takeApplication,
  startPreparationRequest,
  requestCorrectionRequest,
  rejectApplicationRequest,
  addResultRequest,
  markReadyRequest,
  issueApplicationRequest,
  deliverApplicationRequest,
  acceptDocumentRequest,
  requestDocReplacementRequest,
  fetchApplicationDocumentUrl,
  pickLocale,
  type ApplicationDetail,
  type ApplicationDocumentItem,
} from '../../../entities/application-service'
import { Button, Card, Skeleton, EmptyState, PromptDialog } from '../../../shared/ui'

// Состояние текстового промпта для действий сотрудника.
interface Prompt {
  title: string
  multiline?: boolean
  required?: boolean
  run: (value: string) => void
}

// Рабочее место сотрудника по одной заявке (§17): студент, документы-review, действия, timeline.
export function StaffWorkspace({ id, onBack }: { id: string; onBack: () => void }) {
  const t = useTranslations('Applications')
  const locale = useLocale()
  const q = useQuery({ queryKey: applicationKeys.detail(id), queryFn: () => fetchApplication(id) })
  const app = q.data

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label={t('backBtn')}>
          <ArrowLeft className="size-5" aria-hidden />
        </Button>
        <h2 className="truncate text-lg font-semibold">
          {app
            ? pickLocale(app.service as unknown as Record<string, unknown>, 'name', locale)
            : t('title')}
        </h2>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : q.isError || !app ? (
        <EmptyState
          title={t('loadError')}
          action={
            <Button variant="outline" onClick={() => q.refetch()}>
              {t('retry')}
            </Button>
          }
        />
      ) : (
        <>
          <Card className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-muted-foreground">{app.number}</span>
              <ApplicationStatusBadge status={app.status} />
            </div>
            {app.student && (
              <Row
                label={t('studentLabel')}
                value={`${app.student.lastName} ${app.student.firstName}`}
              />
            )}
            {app.deliveryType && (
              <Row label={t('deliveryTitle')} value={t(`delivery_${app.deliveryType}`)} />
            )}
            {app.dueAt && (
              <Row label={t('expectedReady')} value={new Date(app.dueAt).toLocaleString(locale)} />
            )}
            <Row label={t('assignee')} value={app.assignedToId ? '✓' : t('unassigned')} />
            {app.pickupCode && <Row label={t('pickupCodeLabel')} value={app.pickupCode} />}
          </Card>

          {app.documents.length > 0 && (
            <Card className="flex flex-col gap-3 p-4">
              <h3 className="text-sm font-semibold">{t('documentsTitle')}</h3>
              <StaffDocumentReview
                appId={app.id}
                documents={app.documents}
                canReview={app.status === 'IN_REVIEW'}
                onChanged={() => void q.refetch()}
              />
            </Card>
          )}

          {app.results.length > 0 && (
            <Card className="flex flex-col gap-2 p-4">
              <h3 className="text-sm font-semibold">{t('resultTitle')}</h3>
              {app.results.map((r) => (
                <div key={r.id} className="text-sm">
                  {r.documentNumber && (
                    <span className="font-medium">
                      {t('resultDocNumber')}: {r.documentNumber}
                    </span>
                  )}
                  {r.note && <p className="text-muted-foreground">{r.note}</p>}
                </div>
              ))}
            </Card>
          )}

          <Card className="flex flex-col gap-3 p-4">
            <h3 className="text-sm font-semibold">{t('timelineTitle')}</h3>
            <ol className="flex flex-col gap-3">
              {app.events.map((e) => {
                const key = `event_${e.action}`
                const label = t.has(key)
                  ? t(key)
                  : e.toStatus
                    ? t(`status2_${e.toStatus}`)
                    : e.action
                return (
                  <li key={e.id} className="flex gap-3 text-sm">
                    <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" aria-hidden />
                    <div className="flex min-w-0 flex-col">
                      <span className="font-medium">{label}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(e.createdAt).toLocaleString(locale)}
                      </span>
                      {e.comment && (
                        <span className="text-xs text-muted-foreground">{e.comment}</span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          </Card>

          <StaffActions app={app} onDone={() => void q.refetch()} />
        </>
      )}
    </div>
  )
}

// Действия сотрудника по state-machine (кнопки только для допустимых из текущего статуса).
function StaffActions({ app, onDone }: { app: ApplicationDetail; onDone: () => void }) {
  const t = useTranslations('Applications')
  const qc = useQueryClient()
  const done = () => {
    void qc.invalidateQueries({ queryKey: applicationKeys.all })
    onDone()
  }
  const err = () => toast.error(t('loadError'))

  const takeMut = useMutation({
    mutationFn: () => takeApplication(app.id),
    onSuccess: done,
    onError: err,
  })
  const startMut = useMutation({
    mutationFn: () => startPreparationRequest(app.id),
    onSuccess: done,
    onError: err,
  })
  const correctionMut = useMutation({
    mutationFn: (c: string) => requestCorrectionRequest(app.id, c),
    onSuccess: done,
    onError: err,
  })
  const rejectMut = useMutation({
    mutationFn: (r: string) => rejectApplicationRequest(app.id, r),
    onSuccess: done,
    onError: err,
  })
  const resultMut = useMutation({
    mutationFn: (n: string) =>
      addResultRequest(app.id, { type: 'ELECTRONIC_DOCUMENT', documentNumber: n || undefined }),
    onSuccess: () => {
      toast.success(t('actionNeeded'))
      done()
    },
    onError: err,
  })
  const readyMut = useMutation({
    mutationFn: (loc: string) => markReadyRequest(app.id, { pickupLocation: loc || undefined }),
    onSuccess: done,
    onError: err,
  })
  const issueMut = useMutation({
    mutationFn: () => issueApplicationRequest(app.id),
    onSuccess: done,
    onError: err,
  })
  const deliverMut = useMutation({
    mutationFn: () => deliverApplicationRequest(app.id),
    onSuccess: done,
    onError: err,
  })

  const [prompt, setPrompt] = useState<Prompt | null>(null)

  const buttons: React.ReactNode[] = []
  const s = app.status
  if (s === 'SUBMITTED' || s === 'RESUBMITTED') {
    buttons.push(
      <Button
        key="take"
        className="w-full"
        loading={takeMut.isPending}
        onClick={() => takeMut.mutate()}
      >
        {t('take')}
      </Button>,
    )
  }
  if (s === 'IN_REVIEW') {
    buttons.push(
      <Button
        key="start"
        className="w-full"
        loading={startMut.isPending}
        onClick={() => startMut.mutate()}
      >
        {t('startPreparation')}
      </Button>,
    )
    buttons.push(
      <Button
        key="corr"
        variant="outline"
        className="w-full"
        onClick={() =>
          setPrompt({
            title: t('requestCorrection'),
            multiline: true,
            required: true,
            run: (c) => correctionMut.mutate(c),
          })
        }
      >
        {t('requestCorrection')}
      </Button>,
    )
  }
  if (s === 'IN_PREPARATION') {
    buttons.push(
      <Button
        key="result"
        variant="outline"
        className="w-full"
        onClick={() => setPrompt({ title: t('resultDocNumber'), run: (n) => resultMut.mutate(n) })}
      >
        {t('addResult')}
      </Button>,
    )
    buttons.push(
      <Button
        key="ready"
        className="w-full"
        onClick={() => {
          if (app.deliveryType === 'ELECTRONIC') readyMut.mutate('')
          else setPrompt({ title: t('pickupTitle'), run: (loc) => readyMut.mutate(loc) })
        }}
      >
        {t('markReady')}
      </Button>,
    )
  }
  if (s === 'READY_FOR_PICKUP') {
    buttons.push(
      <Button
        key="issue"
        className="w-full"
        loading={issueMut.isPending}
        onClick={() => issueMut.mutate()}
      >
        {t('issue')}
      </Button>,
    )
  }
  if (s === 'READY') {
    buttons.push(
      <Button
        key="deliver"
        className="w-full"
        loading={deliverMut.isPending}
        onClick={() => deliverMut.mutate()}
      >
        {t('deliver')}
      </Button>,
    )
  }
  if (s === 'SUBMITTED' || s === 'IN_REVIEW' || s === 'IN_PREPARATION') {
    buttons.push(
      <Button
        key="reject"
        variant="outline"
        className="w-full text-destructive hover:text-destructive"
        onClick={() =>
          setPrompt({
            title: t('rejectApp'),
            multiline: true,
            required: true,
            run: (r) => rejectMut.mutate(r),
          })
        }
      >
        {t('rejectApp')}
      </Button>,
    )
  }
  if (buttons.length === 0 && !prompt) return null
  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">{buttons}</div>
      <PromptDialog
        open={!!prompt}
        title={prompt?.title ?? ''}
        multiline={prompt?.multiline}
        required={prompt?.required}
        submitLabel={t('promptSubmit')}
        cancelLabel={t('promptCancel')}
        onSubmit={(v) => {
          prompt?.run(v)
          setPrompt(null)
        }}
        onClose={() => setPrompt(null)}
      />
    </>
  )
}

function StaffDocumentReview({
  appId,
  documents,
  canReview,
  onChanged,
}: {
  appId: string
  documents: ApplicationDocumentItem[]
  canReview: boolean
  onChanged: () => void
}) {
  const t = useTranslations('Applications')
  const qc = useQueryClient()
  const done = () => {
    void qc.invalidateQueries({ queryKey: applicationKeys.detail(appId) })
    onChanged()
  }
  const err = () => toast.error(t('loadError'))
  const [replaceFor, setReplaceFor] = useState<string | null>(null)
  const acceptMut = useMutation({
    mutationFn: (docId: string) => acceptDocumentRequest(appId, docId),
    onSuccess: done,
    onError: err,
  })
  const replaceMut = useMutation({
    mutationFn: (v: { docId: string; comment: string }) =>
      requestDocReplacementRequest(appId, v.docId, v.comment),
    onSuccess: done,
    onError: err,
  })
  const viewMut = useMutation({
    mutationFn: (docId: string) => fetchApplicationDocumentUrl(appId, docId),
    onSuccess: (url) => window.open(url, '_blank', 'noopener'),
    onError: err,
  })

  return (
    <div className="flex flex-col gap-2">
      {documents.map((d) => (
        <div key={d.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {d.snapshotTitle ?? d.requirement.titleRu}
            </span>
            <span className="text-xs text-muted-foreground">{t(`docStatus_${d.status}`)}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {d.documentId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => viewMut.mutate(d.id)}
                loading={viewMut.isPending}
              >
                <Eye className="size-4" aria-hidden />
                {t('viewDoc')}
              </Button>
            )}
            {canReview && d.status === 'PENDING' && (
              <>
                <Button variant="outline" size="sm" onClick={() => acceptMut.mutate(d.id)}>
                  <Check className="size-4" aria-hidden />
                  {t('accept')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-amber-600 dark:text-amber-400"
                  onClick={() => setReplaceFor(d.id)}
                >
                  <RefreshCw className="size-4" aria-hidden />
                  {t('requestReplacement')}
                </Button>
              </>
            )}
          </div>
        </div>
      ))}
      <PromptDialog
        open={!!replaceFor}
        title={t('requestReplacement')}
        multiline
        required
        submitLabel={t('promptSubmit')}
        cancelLabel={t('promptCancel')}
        onSubmit={(v) => {
          if (replaceFor) replaceMut.mutate({ docId: replaceFor, comment: v })
          setReplaceFor(null)
        }}
        onClose={() => setReplaceFor(null)}
      />
    </div>
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
