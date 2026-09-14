'use client'

import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarClock, CheckCircle2, Link2, Send, User } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Modal,
  PageHeader,
  Skeleton,
  Textarea,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { toast } from 'sonner'
import {
  assignmentKeys,
  fetchAssignment,
  saveSubmissionDraftRequest,
  submitAssignmentRequest,
} from '../../../entities/assignment'
import {
  studentStatus,
  STUDENT_STATUS_BADGE,
  STUDENT_STATUS_KEY,
  canEditSubmission,
} from '../lib/assignment-status'

interface Props {
  id: string
  onBack: () => void
  /**
   * Показать задание модальным окном поверх списка, а не отдельным экраном: список
   * остаётся под ним — закрыл окно и оказался на той же вкладке с той же прокруткой.
   */
  asModal?: boolean
}

export function StudentAssignmentDetail({ id, onBack, asModal = false }: Props) {
  const t = useTranslations('Assignments')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()

  // placeholderData: при переходе между заданиями показываем прошлую деталь, пока грузится
  // новая (без вспышки скелета) — экран ощущается мгновенным.
  const q = useQuery({
    queryKey: assignmentKeys.detail(id),
    queryFn: () => fetchAssignment(id),
    placeholderData: keepPreviousData,
  })
  const a = q.data

  const [text, setText] = useState('')
  const [linkUrl, setLinkUrl] = useState('')

  useEffect(() => {
    if (a?.mySubmission) {
      setText(a.mySubmission.text ?? '')
      setLinkUrl(a.mySubmission.linkUrl ?? '')
    }
  }, [a?.mySubmission])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: assignmentKeys.detail(id) })
    qc.invalidateQueries({ queryKey: assignmentKeys.list() })
  }

  const saveDraft = useMutation({
    mutationFn: () =>
      saveSubmissionDraftRequest(id, {
        text: text || null,
        linkUrl: linkUrl || null,
      }),
    onSuccess: () => {
      invalidate()
      toast.success(t('draftSaved'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  const submit = useMutation({
    mutationFn: async () => {
      await saveSubmissionDraftRequest(id, { text: text || null, linkUrl: linkUrl || null })
      return submitAssignmentRequest(id)
    },
    onSuccess: () => {
      invalidate()
      toast.success(t('submitted'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  if (q.isLoading || !a) {
    const loading = (
      <>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </>
    )
    if (asModal) {
      return (
        <Modal onClose={onBack} title={t('title')} size="2xl">
          <div className="flex flex-col gap-4">{loading}</div>
        </Modal>
      )
    }
    return <div className="flex w-full flex-1 flex-col gap-4">{loading}</div>
  }

  const st = studentStatus(a)
  const editable = canEditSubmission(a)
  const showText = a.submissionType === 'TEXT' || a.submissionType === 'MIXED'
  const showLink = a.submissionType === 'LINK' || a.submissionType === 'MIXED'
  const sub = a.mySubmission

  const body = (
    <>
      <Card className="py-0">
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <User className="size-4" aria-hidden />
              {a.createdBy.firstName} {a.createdBy.lastName}
            </span>
            {a.dueAt && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="size-4" aria-hidden />
                {new Date(a.dueAt).toLocaleString(locale, {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
            {a.maxScore != null && <span>{t('maxScore', { n: a.maxScore })}</span>}
          </div>
          {a.description && <p className="text-sm whitespace-pre-wrap">{a.description}</p>}
        </CardContent>
      </Card>

      {/* Результат проверки */}
      {sub?.status === 'GRADED' && (
        <Card className="py-0 ring-1 ring-success/30">
          <CardContent className="flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-success" aria-hidden />
              <span className="font-heading text-lg font-semibold">
                {sub.score}
                {a.maxScore != null ? ` / ${a.maxScore}` : ''}
              </span>
            </div>
            {sub.feedback && <p className="text-sm whitespace-pre-wrap">{sub.feedback}</p>}
          </CardContent>
        </Card>
      )}
      {sub?.status === 'RETURNED' && sub.feedback && (
        <Card className="py-0 ring-1 ring-warning/40">
          <CardContent className="flex flex-col gap-1.5 p-4">
            <span className="text-sm font-medium text-warning-foreground dark:text-warning">
              {t('needsFix')}
            </span>
            <p className="text-sm whitespace-pre-wrap">{sub.feedback}</p>
          </CardContent>
        </Card>
      )}

      {/* Форма сдачи / просмотр отправленного */}
      <Card className="py-0">
        <CardContent className="flex flex-col gap-4 p-4">
          <h3 className="font-heading text-sm font-semibold">{t('yourWork')}</h3>
          {showText && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sub-text">{t('answerText')}</Label>
              <Textarea
                id="sub-text"
                rows={6}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={!editable}
                placeholder={editable ? t('answerPlaceholder') : undefined}
              />
            </div>
          )}
          {showLink && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sub-link">{t('answerLink')}</Label>
              <Input
                id="sub-link"
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                disabled={!editable}
                placeholder="https://"
              />
            </div>
          )}

          {sub && (
            <p className="text-xs text-muted-foreground">
              {t('attempt', { n: sub.attemptNumber })}
              {sub.submittedAt
                ? ` · ${t('submittedAt', {
                    d: new Date(sub.submittedAt).toLocaleString(locale, {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  })}`
                : ''}
            </p>
          )}

          {editable && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => saveDraft.mutate()}
                loading={saveDraft.isPending}
              >
                {t('saveDraft')}
              </Button>
              <Button
                onClick={() => submit.mutate()}
                loading={submit.isPending}
                className="gap-1.5"
              >
                <Send className="size-4" aria-hidden />
                {t('submit')}
              </Button>
            </div>
          )}
          {!editable && sub && sub.linkUrl && (
            <a
              href={sub.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm break-all text-primary hover:underline"
            >
              <Link2 className="size-4 shrink-0" aria-hidden />
              {sub.linkUrl}
            </a>
          )}
        </CardContent>
      </Card>
    </>
  )

  // В окне заголовок и закрытие рисует сама оболочка — второй шапки внутри не нужно,
  // статус переезжает в первую карточку.
  if (asModal) {
    return (
      <Modal onClose={onBack} title={a.title} size="2xl">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{a.course.subject.name}</span>
            <Badge variant={STUDENT_STATUS_BADGE[st]}>{t(STUDENT_STATUS_KEY[st])}</Badge>
          </div>
          {body}
        </div>
      </Modal>
    )
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader
        title={a.title}
        subtitle={a.course.subject.name}
        onBack={onBack}
        backLabel={t('back')}
        actions={<Badge variant={STUDENT_STATUS_BADGE[st]}>{t(STUDENT_STATUS_KEY[st])}</Badge>}
      />
      {body}
    </div>
  )
}
