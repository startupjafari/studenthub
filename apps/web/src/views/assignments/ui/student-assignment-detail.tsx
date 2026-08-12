'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarClock, CheckCircle2, Link2, Send, User } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
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
}

export function StudentAssignmentDetail({ id, onBack }: Props) {
  const t = useTranslations('Assignments')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()

  const q = useQuery({ queryKey: assignmentKeys.detail(id), queryFn: () => fetchAssignment(id) })
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
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  const st = studentStatus(a)
  const editable = canEditSubmission(a)
  const showText = a.submissionType === 'TEXT' || a.submissionType === 'MIXED'
  const showLink = a.submissionType === 'LINK' || a.submissionType === 'MIXED'
  const sub = a.mySubmission

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <PageHeader
        title={a.title}
        subtitle={a.course.subject.name}
        onBack={onBack}
        backLabel={t('back')}
        actions={<Badge variant={STUDENT_STATUS_BADGE[st]}>{t(STUDENT_STATUS_KEY[st])}</Badge>}
      />

      <Card>
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
        <Card className="ring-1 ring-success/30">
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
        <Card className="ring-1 ring-warning/40">
          <CardContent className="flex flex-col gap-1.5 p-4">
            <span className="text-sm font-medium text-warning-foreground dark:text-warning">
              {t('needsFix')}
            </span>
            <p className="text-sm whitespace-pre-wrap">{sub.feedback}</p>
          </CardContent>
        </Card>
      )}

      {/* Форма сдачи / просмотр отправленного */}
      <Card>
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
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <Link2 className="size-4" aria-hidden />
              {sub.linkUrl}
            </a>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
