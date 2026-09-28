'use client'

import { useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  ApproveDemoRequestSchema,
  DemoRejectionReasonSchema,
  type ApproveDemoRequestInput,
  type DemoRejectionReasonValue,
} from '@studenthub/shared-schemas'
import {
  approveDemoRequest,
  rejectDemoRequest,
  type DemoRequest,
} from '../../../entities/onboarding'
import {
  Badge,
  Button,
  FormAlert,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '../../../shared/ui'
import { OPTIONAL_TEXT, useFormAlert } from '../../../shared/lib'

const REASONS = DemoRejectionReasonSchema.options

/** Цвет статусной плашки — тот же, что в строке очереди: один статус, один цвет. */
const STATUS_STYLE: Record<DemoRequest['status'], string> = {
  PENDING_EMAIL: 'text-muted-foreground',
  NEW: 'text-warning',
  APPROVED: 'text-success',
  REJECTED: 'text-destructive',
}

interface Props {
  request: DemoRequest
  onClose: () => void
  onDecided: (request: DemoRequest) => void
}

/**
 * Карточка заявки и решение по ней.
 *
 * Три состояния одного окна: сама заявка, форма одобрения, форма отказа. Обе формы
 * открываются из карточки, а не стоят рядом с ней: одобрение заводит вуз и открывает
 * доступ живым людям, и между «прочитал» и «сделал» должен быть ещё один шаг.
 *
 * У решённой заявки форм нет вовсе — только то, что решили и когда. Кнопка «одобрить»
 * на уже одобренной заявке обещает действие, которого не будет: сервер ответит
 * конфликтом, и это правильно, но спрашивать об этом не надо.
 */
export function DemoRequestModal({ request, onClose, onDecided }: Props) {
  const t = useTranslations('DemoAdmin')
  const tCommon = useTranslations('Common')
  const locale = useLocale()
  const [mode, setMode] = useState<'view' | 'approve' | 'reject'>('view')

  const decided = request.status !== 'NEW'

  return (
    // Заголовок окна — родовой, а не название вуза: так же устроен разбор жалобы. Само
    // название стоит внутри заголовком карточки, где его не обрежет шапка окна.
    <Modal onClose={onClose} title={t('detailTitle')} size="lg">
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={STATUS_STYLE[request.status]}>
              {t(`status${request.status}`)}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {new Date(request.createdAt).toLocaleString(locale, {
                dateStyle: 'long',
                timeStyle: 'short',
              })}
            </span>
          </div>
          <h3 className="text-base font-semibold">{request.universityName}</h3>
        </header>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
          <Field label={t('colContact')}>{request.contactName}</Field>
          <Field label={t('fieldRole')}>{request.contactRole || '—'}</Field>
          <Field label={t('colEmail')}>{request.email}</Field>
          <Field label={t('fieldPhone')}>{request.phone || '—'}</Field>
          <Field label={t('fieldCity')}>{request.city || '—'}</Field>
          <Field label={t('fieldStudents')}>{request.studentsEstimate ?? '—'}</Field>
          <Field label={t('fieldWebsite')}>{request.website || '—'}</Field>
          <Field label={t('fieldConsent')}>
            {new Date(request.consentAt).toLocaleDateString(locale, { dateStyle: 'long' })}
          </Field>
        </dl>

        {/* Комментарий — свободный текст произвольной длины, в ровную сетку пар он не
            ложится: там значения обрезаются по строке, а тут читают целиком. */}
        {request.comment && (
          <section className="flex flex-col gap-1.5 rounded-xl border border-border p-3">
            <h4 className="text-sm font-medium">{t('fieldComment')}</h4>
            <p className="text-sm whitespace-pre-line text-muted-foreground">{request.comment}</p>
          </section>
        )}

        {decided && (
          <section className="flex flex-col gap-1 rounded-xl border border-border bg-muted/40 p-3">
            <h4 className="text-sm font-medium">
              {request.status === 'APPROVED' ? t('approved') : t('rejected')}
            </h4>
            {request.rejectionReason && (
              <p className="text-sm text-muted-foreground">
                {t(`reason${request.rejectionReason}`)}
              </p>
            )}
            {request.reviewNote && (
              <p className="text-sm text-muted-foreground">{request.reviewNote}</p>
            )}
          </section>
        )}

        {mode === 'approve' && (
          <ApproveForm request={request} onBack={() => setMode('view')} onDecided={onDecided} />
        )}
        {mode === 'reject' && (
          <RejectForm request={request} onBack={() => setMode('view')} onDecided={onDecided} />
        )}

        {/* Подвал: слева выход без решения, справа сами решения — как в разборе жалобы.
            У решённой заявки решений нет: кнопка «одобрить» на одобренной обещает
            действие, которого не будет. */}
        {mode === 'view' && (
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              {tCommon('close')}
            </Button>
            {!decided && (
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="destructive" onClick={() => setMode('reject')}>
                  {t('reject')}
                </Button>
                <Button type="button" onClick={() => setMode('approve')}>
                  {t('approve')}
                </Button>
              </div>
            )}
          </footer>
        )}
      </div>
    </Modal>
  )
}

/** Пара «подпись — значение» списка деталей. Все пары одной сетки, поэтому колонки ровные. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{children}</dd>
    </div>
  )
}

/**
 * Одобрение. Реквизиты вуза предзаполнены из заявки и доступны для правки: их писал
 * человек снаружи, и «КазНУ» вместо полного названия — обычное дело. Почта не
 * редактируется вовсе: приглашение обязано уйти на тот адрес, который подтвердили
 * письмом, иначе подтверждение ничего не значит.
 */
function ApproveForm({
  request,
  onBack,
  onDecided,
}: {
  request: DemoRequest
  onBack: () => void
  onDecided: (request: DemoRequest) => void
}) {
  const t = useTranslations('DemoAdmin')
  const { error, show, reset } = useFormAlert()

  const form = useForm<ApproveDemoRequestInput>({
    resolver: zodResolver(ApproveDemoRequestSchema),
    defaultValues: {
      name: request.universityName,
      city: request.city ?? undefined,
      country: request.country ?? undefined,
    },
  })

  const mut = useMutation({
    mutationFn: (input: ApproveDemoRequestInput) => approveDemoRequest(request.id, input),
    onSuccess: onDecided,
    onError: show,
  })

  return (
    <form
      onSubmit={form.handleSubmit((values) => {
        reset()
        mut.mutate(values)
      })}
      className="flex flex-col gap-4 border-t border-border pt-4"
    >
      <FormAlert error={error} />
      <p className="text-sm text-muted-foreground">
        {t('approveExplain', { email: request.email })}
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="d-name">{t('fieldUniversityName')}</Label>
        <Input id="d-name" autoFocus {...form.register('name')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="d-short">{t('fieldShortName')}</Label>
          <Input id="d-short" {...form.register('shortName', OPTIONAL_TEXT)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="d-city">{t('fieldCity')}</Label>
          <Input id="d-city" {...form.register('city', OPTIONAL_TEXT)} />
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onBack}>
          {t('back')}
        </Button>
        <Button type="submit" loading={mut.isPending}>
          {t('approveConfirm')}
        </Button>
      </div>
    </form>
  )
}

/** Отказ: причина из закрытого списка плюс внутренняя заметка, которая в письмо не идёт. */
function RejectForm({
  request,
  onBack,
  onDecided,
}: {
  request: DemoRequest
  onBack: () => void
  onDecided: (request: DemoRequest) => void
}) {
  const t = useTranslations('DemoAdmin')
  const { error, show, reset } = useFormAlert()
  const [reason, setReason] = useState<DemoRejectionReasonValue>('NO_CAPACITY')
  const [note, setNote] = useState('')

  const mut = useMutation({
    mutationFn: () => rejectDemoRequest(request.id, { reason, note: note.trim() || undefined }),
    onSuccess: onDecided,
    onError: show,
  })

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <FormAlert error={error} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="d-reason">{t('fieldReason')}</Label>
        <Select value={reason} onValueChange={(v) => setReason(v as DemoRejectionReasonValue)}>
          <SelectTrigger id="d-reason">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REASONS.map((r) => (
              <SelectItem key={r} value={r}>
                {t(`reason${r}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Прямо говорим, что уйдёт человеку: причина выбирается для него, а не для отчёта. */}
        <p className="text-xs text-muted-foreground">{t(`reason${reason}`)}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="d-note">{t('fieldNote')}</Label>
        <Textarea id="d-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="text-xs text-muted-foreground">{t('noteInternal')}</p>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onBack}>
          {t('back')}
        </Button>
        <Button
          variant="destructive"
          loading={mut.isPending}
          onClick={() => {
            reset()
            mut.mutate()
          }}
        >
          {t('rejectConfirm')}
        </Button>
      </div>
    </div>
  )
}
