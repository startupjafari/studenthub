'use client'

import { useState } from 'react'
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
  const locale = useLocale()
  const [mode, setMode] = useState<'view' | 'approve' | 'reject'>('view')

  const decided = request.status !== 'NEW'

  return (
    <Modal onClose={onClose} title={request.universityName} size="lg">
      <div className="flex flex-col gap-5">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Fact label={t('colContact')} value={request.contactName} />
          <Fact label={t('fieldRole')} value={request.contactRole} />
          <Fact label={t('colEmail')} value={request.email} />
          <Fact label={t('fieldPhone')} value={request.phone} />
          <Fact label={t('fieldCity')} value={request.city} />
          <Fact
            label={t('fieldStudents')}
            value={request.studentsEstimate ? String(request.studentsEstimate) : null}
          />
          <Fact label={t('fieldWebsite')} value={request.website} />
          <Fact
            label={t('colCreatedAt')}
            value={new Date(request.createdAt).toLocaleString(locale, {
              dateStyle: 'long',
              timeStyle: 'short',
            })}
          />
        </dl>

        {request.comment && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('fieldComment')}</span>
            <p className="text-sm whitespace-pre-line">{request.comment}</p>
          </div>
        )}

        {/* Согласие — часть заявки, а не примечание: по нему отвечают, если спросят,
            на каком основании эти данные вообще лежат в базе. */}
        <p className="text-xs text-muted-foreground">
          {t('consentGiven', {
            date: new Date(request.consentAt).toLocaleDateString(locale, { dateStyle: 'long' }),
            version: request.consentVersion,
          })}
        </p>

        {decided ? (
          <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">
              {request.status === 'APPROVED' ? t('approved') : t('rejected')}
            </p>
            {request.rejectionReason && (
              <p className="text-muted-foreground">{t(`reason${request.rejectionReason}`)}</p>
            )}
            {request.reviewNote && (
              <p className="mt-1 text-muted-foreground">{request.reviewNote}</p>
            )}
          </div>
        ) : mode === 'view' ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setMode('reject')}>
              {t('reject')}
            </Button>
            <Button onClick={() => setMode('approve')}>{t('approve')}</Button>
          </div>
        ) : mode === 'approve' ? (
          <ApproveForm request={request} onBack={() => setMode('view')} onDecided={onDecided} />
        ) : (
          <RejectForm request={request} onBack={() => setMode('view')} onDecided={onDecided} />
        )}
      </div>
    </Modal>
  )
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{value || '—'}</dd>
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
