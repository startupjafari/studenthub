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
  fetchApplicationAssignees,
  assignApplicationRequest,
  revokeCertificateRequest,
  pickLocale,
  CERTIFICATE_RESULT_TYPE,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { cn, toApiError } from '../../../shared/lib'
import { TERMINAL_STATUSES } from '@studenthub/shared-schemas'
import { ResultModal } from './result-modal'
import { FormAnswers } from './form-answers'
import { useActionError } from '../lib/use-action-error'
import { eventComment } from '../lib/requirement-titles'

// Состояние текстового промпта для действий сотрудника.
interface Prompt {
  title: string
  placeholder?: string
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

  // Окно собрано сверху вниз по важности: что за заявка и в каком она статусе (шапка) → на
  // каком этапе → сведения → ответы и документы → история. Действия — в нижней полосе вне
  // прокрутки: они всегда в одном месте, сколько бы ни было содержимого.
  return (
    <Modal
      onClose={onClose}
      title={serviceName ?? t('title')}
      headerAction={app && <ApplicationStatusBadge status={app.status} />}
      size="2xl"
      bodyClassName="overflow-hidden p-0"
    >
      {q.isLoading ? (
        <div className="p-5">
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : q.isError || !app ? (
        <div className="p-5">
          <EmptyState
            title={t('loadError')}
            action={
              <Button variant="outline" onClick={() => q.refetch()}>
                {t('retry')}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
            <Stepper
              layout="centered"
              steps={deanSteps}
              current={viewStep}
              done={activeStep}
              onStepClick={(i) => i <= activeStep && setSelected(i)}
            />

            <Card className="flex flex-col gap-4 p-4">
              <h3 className="text-sm font-semibold">{t('infoTitle')}</h3>
              {/* Сетка 2×N: пары «кто / как», «когда подано / к какому сроку». На телефоне —
                  одна колонка. */}
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <Row label={t('numberLabel')} value={app.number} />
                {app.submittedAt && (
                  <Row
                    label={t('submittedAtLabel')}
                    value={formatDateTime(app.submittedAt, locale)}
                  />
                )}
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
                  <Row label={t('expectedReady')} value={formatDateTime(app.dueAt, locale)} />
                )}
                <AssigneeRow app={app} onChanged={() => void q.refetch()} />
              </dl>
            </Card>

            {/* Ответы анкеты — на всех этапах: по ним решают «подготовить или отклонить», а
                при подготовке берут, например, организацию для справки. */}
            <FormAnswers fields={app.service.formFields ?? []} formData={app.formData} />

            {/* Шаг «Проверка» — документы заявки */}
            {viewStep === 0 && app.documents.length > 0 && (
              <Card className="flex flex-col gap-3 p-4">
                <h3 className="text-sm font-semibold">{t('documentsTitle')}</h3>
                <StaffDocumentReview
                  appId={app.id}
                  documents={app.documents}
                  // В исправлении проверка продолжается: можно пометить к замене ещё документ,
                  // а не отправлять каждый отдельным кругом.
                  canReview={app.status === 'IN_REVIEW' || app.status === 'NEEDS_CORRECTION'}
                  onChanged={() => void q.refetch()}
                />
              </Card>
            )}

            {/* Шаги «Подготовка»/«Выдача» — результат заявки. У отклонённой — тоже: справку,
                выданную до отказа, должно быть видно и можно отозвать. */}
            {(viewStep >= 1 || app.status === 'REJECTED') && app.results.length > 0 && (
              <Card className="flex flex-col gap-2 p-4">
                <h3 className="text-sm font-semibold">{t('resultTitle')}</h3>
                {app.results.map((r) => (
                  <ResultRow key={r.id} appId={app.id} result={r} />
                ))}
                <RevokeCertificate app={app} onDone={() => void q.refetch()} />
              </Card>
            )}

            <Timeline app={app} />
          </div>

          {/* Действия относятся к заявке, а не к просматриваемому этапу: полоса не пропадает,
              когда сотрудник листает пройденные шаги, и кнопки не прыгают по окну. */}
          <StaffActions app={app} onDone={() => void q.refetch()} />
        </div>
      )}
    </Modal>
  )
}

// Дата и время без секунд: секунды в заявке ничего не решают, а строку удлиняют.
function formatDateTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}

// История заявки — по времени, от первого события к последнему. Порядок с сервера не
// гарантирован: назначение ответственного приходило раньше создания черновика.
function Timeline({ app }: { app: ApplicationDetail }) {
  const t = useTranslations('Applications')
  const locale = useLocale()
  const events = [...app.events].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
  if (events.length === 0) return null

  return (
    <Card className="flex flex-col gap-4 p-4">
      <h3 className="text-sm font-semibold">{t('timelineTitle')}</h3>
      <ol className="flex flex-col">
        {events.map((e, i) => {
          const key = `event_${e.action}`
          const label = t.has(key) ? t(key) : e.toStatus ? t(`status2_${e.toStatus}`) : e.action
          const comment = eventComment(e, app, locale)
          const last = i === events.length - 1
          return (
            <li key={e.id} className="flex gap-3 text-sm">
              {/* Точка и линия к следующему событию — одна колонка, линия тянется по высоте
                  записи, сколько бы строк ни занял комментарий. */}
              <div className="flex flex-col items-center" aria-hidden>
                <span
                  className={cn(
                    'mt-1.5 size-2 shrink-0 rounded-full',
                    last ? 'bg-primary' : 'bg-primary/40',
                  )}
                />
                {!last && <span className="mt-1 w-px flex-1 bg-border" />}
              </div>
              <div className={cn('flex min-w-0 flex-1 flex-col gap-0.5', !last && 'pb-4')}>
                <div className="flex flex-col gap-x-3 gap-y-0.5 sm:flex-row sm:items-baseline sm:justify-between">
                  <span className="font-medium">{label}</span>
                  <time
                    dateTime={e.createdAt}
                    className="shrink-0 text-xs text-muted-foreground tabular-nums"
                  >
                    {formatDateTime(e.createdAt, locale)}
                  </time>
                </div>
                {comment && (
                  <span className="text-xs whitespace-pre-line text-muted-foreground">
                    {comment}
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </Card>
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
  const err = useActionError()

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
    mutationFn: (pickupCode: string) => issueApplicationRequest(app.id, pickupCode),
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

  // Три группы кнопок с постоянными местами: отказ — слева, вспомогательные и основное
  // действие — справа, основное крайним. На телефоне порядок обратный: основное сверху,
  // под большим пальцем, отказ — внизу, подальше от случайного нажатия.
  let primary: React.ReactNode = null
  const secondary: React.ReactNode[] = []
  let danger: React.ReactNode = null
  const btn = 'w-full sm:w-auto'
  const s = app.status
  // Отозванная справка результатом не считается (сервер проверяет то же самое).
  const hasActiveResult = app.results.some((r) => !r.revoked)
  if (s === 'SUBMITTED' || s === 'RESUBMITTED') {
    primary = (
      <Button className={btn} loading={takeMut.isPending} onClick={() => takeMut.mutate()}>
        {t('take')}
      </Button>
    )
  }
  if (s === 'IN_REVIEW') {
    primary = (
      <Button className={btn} loading={startMut.isPending} onClick={() => startMut.mutate()}>
        {t('startPreparation')}
      </Button>
    )
    secondary.push(
      <Button
        key="corr"
        variant="outline"
        className={btn}
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
    secondary.push(
      <Button key="result" variant="outline" className={btn} onClick={() => setResultOpen(true)}>
        {t('addResult')}
      </Button>,
    )
    primary = (
      <Button
        className={btn}
        onClick={() => {
          // Электронную выдачу без результата сервер не примет: студенту пришло бы «готово»,
          // а скачать нечего. Подсказываем до запроса, а не общей ошибкой после.
          if (app.deliveryType !== 'PAPER' && !hasActiveResult) {
            toast.error(t('readyNeedsResult'))
            return
          }
          if (app.deliveryType === 'ELECTRONIC') readyMut.mutate('')
          else setPrompt({ title: t('pickupTitle'), run: (loc) => readyMut.mutate(loc) })
        }}
      >
        {t('markReady')}
      </Button>
    )
  }
  // Справку отозвали уже после «готово» — до передачи студенту её можно выпустить заново.
  if ((s === 'READY' || s === 'READY_FOR_PICKUP') && !hasActiveResult && app.results.length > 0) {
    secondary.push(
      <Button key="result" variant="outline" className={btn} onClick={() => setResultOpen(true)}>
        {t('addResult')}
      </Button>,
    )
  }
  if (s === 'READY_FOR_PICKUP') {
    primary = (
      <Button
        className={btn}
        loading={issueMut.isPending}
        onClick={() =>
          // Код получения называет студент, сервер сверяет: сотрудник его не видит, и
          // оригинал не выдаётся без того, кто подавал заявку.
          setPrompt({
            title: t('issuePickupCodeTitle'),
            placeholder: t('pickupCodeLabel'),
            required: true,
            run: (code) => issueMut.mutate(code.trim()),
          })
        }
      >
        {t('issue')}
      </Button>
    )
  }
  if (s === 'READY') {
    primary = (
      <Button className={btn} loading={deliverMut.isPending} onClick={() => deliverMut.mutate()}>
        {t('deliver')}
      </Button>
    )
  }
  if (s === 'SUBMITTED' || s === 'IN_REVIEW' || s === 'IN_PREPARATION') {
    danger = (
      <Button
        variant="ghost"
        className={cn(btn, 'text-destructive hover:text-destructive sm:mr-auto')}
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
      </Button>
    )
  }
  // Ход за студентом: кнопок нет, но полоса остаётся с пояснением — иначе окно без действий
  // выглядит сломанным, а не ждущим.
  const waiting = s === 'NEEDS_CORRECTION' ? t('waitingCorrection') : null
  const hasButtons = !!primary || !!danger || secondary.length > 0
  if (!hasButtons && !waiting && !prompt && !resultOpen) return null
  return (
    <>
      {(hasButtons || waiting) && (
        <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
          {waiting && <p className="text-sm text-muted-foreground sm:mr-auto">{waiting}</p>}
          {danger}
          {secondary}
          {primary}
        </div>
      )}
      {resultOpen && (
        <ResultModal appId={app.id} onClose={() => setResultOpen(false)} onDone={done} />
      )}
      <PromptDialog
        open={!!prompt}
        title={prompt?.title ?? ''}
        placeholder={prompt?.placeholder}
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
  const locale = useLocale()
  const qc = useQueryClient()
  const done = () => {
    void qc.invalidateQueries({ queryKey: applicationKeys.detail(appId) })
    onChanged()
  }
  const err = useActionError()
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
  // Каждая страница открывается своей ссылкой: раньше сервер отдавал только первую, и
  // документ принимали, не видя оборота паспорта или приложения к диплому.
  const viewMut = useMutation({
    mutationFn: (v: { docId: string; fileId?: string }) =>
      fetchApplicationDocumentUrl(appId, v.docId, v.fileId),
    onSuccess: (url) => window.open(url, '_blank', 'noopener'),
    onError: err,
  })
  const viewing = (docId: string, fileId?: string) =>
    viewMut.isPending && viewMut.variables?.docId === docId && viewMut.variables.fileId === fileId

  return (
    <div className="flex flex-col gap-2">
      {documents.map((d) => (
        <div key={d.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {pickLocale(d.requirement as unknown as Record<string, unknown>, 'title', locale)}
            </span>
            <span className="text-xs text-muted-foreground">{t(`docStatus_${d.status}`)}</span>
          </div>
          {/* Название самого документа из хранилища студента — под требованием, на которое он
              приложен: требование подписано на языке интерфейса, документ — как его назвали. */}
          {d.snapshotTitle && (
            <span className="truncate text-xs text-muted-foreground">{d.snapshotTitle}</span>
          )}
          <div className="flex flex-wrap gap-2">
            {d.documentId && (d.files?.length ?? 0) > 1
              ? d.files!.map((f, i) => (
                  <Button
                    key={f.id}
                    variant="ghost"
                    size="sm"
                    onClick={() => viewMut.mutate({ docId: d.id, fileId: f.id })}
                    loading={viewing(d.id, f.id)}
                  >
                    <Eye className="size-4" aria-hidden />
                    {t('viewDocPage', { page: i + 1 })}
                  </Button>
                ))
              : d.documentId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => viewMut.mutate({ docId: d.id, fileId: d.files?.[0]?.id })}
                    loading={viewing(d.id, d.files?.[0]?.id)}
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
    revoked?: boolean
  }
}) {
  const t = useTranslations('Applications')
  const err = useActionError()
  const downloadMut = useMutation({
    mutationFn: () => fetchApplicationResultUrl(appId, result.id, true),
    // Ссылка presigned и одноразовая по сути — открываем её сразу, файл уходит вложением.
    onSuccess: (url) => window.open(url, '_blank', 'noopener'),
    onError: err,
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
        {result.revoked && (
          <span className="text-xs font-medium text-destructive">{t('resultRevoked')}</span>
        )}
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

/**
 * Ответственный за заявку. Список — только те, кто сам вправе её вести (сервер проверяет то
 * же самое): админ и модератор вуза, декан факультета заявки. У закрытой заявки — только чтение.
 */
function AssigneeRow({ app, onChanged }: { app: ApplicationDetail; onChanged: () => void }) {
  const t = useTranslations('Applications')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const closed = TERMINAL_STATUSES.includes(app.status)
  const candidates = useQuery({
    queryKey: applicationKeys.assignees(app.id),
    queryFn: () => fetchApplicationAssignees(app.id),
    enabled: !closed,
  })
  const assign = useMutation({
    mutationFn: (userId: string) => assignApplicationRequest(app.id, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: applicationKeys.all })
      toast.success(t('assigned'))
      onChanged()
    },
    onError: (error) => toast.error(tErr(toApiError(error).code)),
  })

  const people = candidates.data ?? []
  const current = people.find((p) => p.id === app.assignedToId)
  const fullName = (p: { firstName: string; lastName: string }) => `${p.lastName} ${p.firstName}`

  if (closed || candidates.isError) {
    return (
      <Row
        label={t('assignee')}
        value={
          current ? fullName(current) : app.assignedToId ? t('assignedSomeone') : t('unassigned')
        }
      />
    )
  }

  return (
    // Селект — во всю ширину своей ячейки сетки, вровень с соседней колонкой.
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{t('assignee')}</dt>
      <dd>
        <Select
          value={app.assignedToId ?? undefined}
          onValueChange={(userId) => assign.mutate(userId)}
          disabled={assign.isPending || candidates.isLoading}
        >
          <SelectTrigger size="sm" className="w-full" aria-label={t('assignee')}>
            <SelectValue placeholder={t('unassigned')} />
          </SelectTrigger>
          <SelectContent>
            {/* Назначенный мог уйти из круга (заблокирован, сменил факультет) — показываем его,
              чтобы селект не выглядел пустым при живом назначении. */}
            {app.assignedToId && !current && (
              <SelectItem value={app.assignedToId} disabled>
                {t('assignedSomeone')}
              </SelectItem>
            )}
            {people.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {fullName(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </dd>
    </div>
  )
}

/**
 * Отзыв выданной справки. Файл у студента остаётся (изъять его нельзя), но проверка по коду
 * с этого момента отвечает «документ отозван». Кнопка видна, пока есть неотозванная справка,
 * сформированная платформой: у загруженного файла или бумажного результата кода проверки нет,
 * и отзывать там нечего (сервер ответил бы 404). «Уже отозвано» — тоже 404, его и показываем.
 */
function RevokeCertificate({ app, onDone }: { app: ApplicationDetail; onDone: () => void }) {
  const t = useTranslations('Applications')
  const tErr = useTranslations('Errors')
  const [asking, setAsking] = useState(false)
  const revoke = useMutation({
    mutationFn: (reason: string) => revokeCertificateRequest(app.id, reason || undefined),
    onSuccess: () => {
      toast.success(t('certificateRevoked'))
      onDone()
    },
    onError: (error) => {
      const code = toApiError(error).code
      toast.error(code === 'NOT_FOUND' ? t('certificateNothingToRevoke') : tErr(code))
    },
  })

  if (!app.results.some((r) => r.type === CERTIFICATE_RESULT_TYPE && !r.revoked)) return null

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="self-start text-destructive"
        loading={revoke.isPending}
        onClick={() => setAsking(true)}
      >
        {t('revokeCertificate')}
      </Button>
      <PromptDialog
        open={asking}
        title={t('revokeCertificateTitle')}
        placeholder={t('revokeCertificateReason')}
        multiline
        submitLabel={t('revokeCertificate')}
        cancelLabel={t('promptCancel')}
        onSubmit={(reason) => {
          revoke.mutate(reason)
          setAsking(false)
        }}
        onClose={() => setAsking(false)}
      />
    </>
  )
}

// Пара «подпись — значение» в сетке сведений (`<dl>`).
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium break-words">{value}</dd>
    </div>
  )
}
