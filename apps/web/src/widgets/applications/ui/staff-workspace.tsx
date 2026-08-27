'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Eye, Check, Download, RefreshCw } from 'lucide-react'
import {
  ApplicationStatusBadge,
  applicationKeys,
  fetchApplication,
  takeApplication,
  startPreparationRequest,
  requestCorrectionRequest,
  rejectApplicationRequest,
  markReadyRequest,
  issueApplicationRequest,
  deliverApplicationRequest,
  acceptDocumentRequest,
  requestDocReplacementRequest,
  fetchApplicationDocumentUrl,
  fetchApplicationResultUrl,
  pickLocale,
  type ApplicationDetail,
  type ApplicationDocumentItem,
} from '../../../entities/application-service'
import {
  Button,
  Card,
  Modal,
  Skeleton,
  Stepper,
  EmptyState,
  PromptDialog,
} from '../../../shared/ui'
import { ResultModal } from './result-modal'

// Состояние текстового промпта для действий сотрудника.
interface Prompt {
  title: string
  multiline?: boolean
  required?: boolean
  run: (value: string) => void
}

// Этап обработки по текущему статусу: 0 Проверка · 1 Подготовка · 2 Выдача.
function deanActiveStep(status: string): number {
  if (status === 'IN_PREPARATION') return 1
  if (['READY', 'READY_FOR_PICKUP', 'ISSUED', 'DELIVERED'].includes(status)) return 2
  return 0
}

// Рабочее место сотрудника по одной заявке (§17): студент, документы-review, действия, timeline.
// Живёт в модальном окне поверх очереди: раньше оно подменяло собой весь экран, и после
// закрытия очередь возвращалась к первой странице с исходным фильтром.
export function StaffWorkspaceModal({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations('Applications')
  const locale = useLocale()
  const q = useQuery({ queryKey: applicationKeys.detail(id), queryFn: () => fetchApplication(id) })
  const app = q.data
  const serviceName = app
    ? pickLocale(app.service as unknown as Record<string, unknown>, 'name', locale)
    : undefined

  // Степпер обработки: по умолчанию следует за статусом; клик — просмотр пройденного этапа.
  const [selected, setSelected] = useState<number | null>(null)
  const activeStep = app ? deanActiveStep(app.status) : 0
  const viewStep = selected ?? activeStep
  const deanSteps = [
    { id: 'review', label: t('dStepReview') },
    { id: 'prepare', label: t('dStepPrepare') },
    { id: 'issue', label: t('dStepIssue') },
  ]

  return (
    <Modal onClose={onClose} title={serviceName ?? t('title')} size="2xl">
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
        <div className="flex flex-col gap-4">
          <Stepper
            steps={deanSteps}
            current={viewStep}
            done={activeStep}
            onStepClick={(i) => i <= activeStep && setSelected(i)}
          />

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

          {/* Шаг «Проверка» — документы заявки */}
          {viewStep === 0 && app.documents.length > 0 && (
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

          {/* Шаги «Подготовка»/«Выдача» — результат заявки */}
          {viewStep >= 1 && app.results.length > 0 && (
            <Card className="flex flex-col gap-2 p-4">
              <h3 className="text-sm font-semibold">{t('resultTitle')}</h3>
              {app.results.map((r) => (
                <ResultRow key={r.id} appId={app.id} result={r} />
              ))}
            </Card>
          )}

          {/* Действия — только на текущем этапе обработки */}
          {viewStep === activeStep && <StaffActions app={app} onDone={() => void q.refetch()} />}

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
        </div>
      )}
    </Modal>
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
  // Результат — не одно текстовое поле: тип, файл готовой справки, вид документа,
  // номер и примечание. Для этого отдельная форма, а не PromptDialog.
  const [resultOpen, setResultOpen] = useState(false)

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
      <Button key="result" variant="outline" className="w-full" onClick={() => setResultOpen(true)}>
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
  if (buttons.length === 0 && !prompt && !resultOpen) return null
  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">{buttons}</div>
      {resultOpen && (
        <ResultModal appId={app.id} onClose={() => setResultOpen(false)} onDone={done} />
      )}
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
                  className="text-warning"
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

// Строка результата: номер/примечание + скачивание выданного документа. Ссылку берём
// у заявки — она гейтится scope заявки, а сам документ принадлежит студенту.
function ResultRow({
  appId,
  result,
}: {
  appId: string
  result: {
    id: string
    documentId: string | null
    documentNumber: string | null
    note: string | null
  }
}) {
  const t = useTranslations('Applications')
  const downloadMut = useMutation({
    mutationFn: () => fetchApplicationResultUrl(appId, result.id, true),
    // Ссылка presigned и одноразовая по сути — открываем её сразу, файл уходит вложением.
    onSuccess: (url) => window.open(url, '_blank', 'noopener'),
    onError: () => toast.error(t('loadError')),
  })
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="flex min-w-0 flex-1 flex-col">
        {result.documentNumber && (
          <span className="font-medium">
            {t('resultDocNumber')}: {result.documentNumber}
          </span>
        )}
        {result.note && <p className="text-muted-foreground">{result.note}</p>}
      </div>
      {result.documentId && (
        <Button
          variant="outline"
          size="sm"
          loading={downloadMut.isPending}
          onClick={() => downloadMut.mutate()}
        >
          <Download className="size-4" aria-hidden />
          {t('downloadResult')}
        </Button>
      )}
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
