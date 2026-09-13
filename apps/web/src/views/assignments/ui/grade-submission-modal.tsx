'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CheckCircle2, Link2, RotateCcw } from 'lucide-react'
import { Badge, Button, Input, Label, Modal, Textarea } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { useErrorToast } from '../../../shared/lib'
import {
  assignmentKeys,
  gradeSubmissionRequest,
  returnSubmissionRequest,
  type SubmissionItem,
} from '../../../entities/assignment'

interface Props {
  assignmentId: string
  maxScore: number | null
  submission: SubmissionItem
  onClose: () => void
  /** Работа оценена или возвращена — родитель переходит к следующей непроверенной. */
  onGraded: () => void
}

/**
 * Проверка одной работы: сама сдача + балл и комментарий.
 *
 * Окно, а не вторая колонка на странице: на странице список сдач и форма делили высоту
 * экрана, и в длинной группе список уезжал за нижний край вместе с формой. Окно держит
 * проверку в одном месте — под ней ничего не прокручивается, и очередь остаётся на месте.
 */
export function GradeSubmissionModal({
  assignmentId,
  maxScore,
  submission,
  onClose,
  onGraded,
}: Props) {
  const t = useTranslations('Assignments')
  const tCommon = useTranslations('Common')
  const locale = useLocale()
  const qc = useQueryClient()
  // Серверный отказ — тостом, а не алертом в окне (§9): алерт раздвинул бы окно
  // и увёл кнопки из-под курсора ровно при повторной попытке.
  const errorToast = useErrorToast(`grade-${submission.id}`)
  const [score, setScore] = useState(submission.score != null ? String(submission.score) : '')
  const [feedback, setFeedback] = useState(submission.feedback ?? '')

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: assignmentKeys.submissions(assignmentId) })
  const gradable = submission.status === 'SUBMITTED'

  const grade = useMutation({
    mutationFn: () =>
      gradeSubmissionRequest(submission.id, {
        score: Number(score),
        ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
      }),
    onSuccess: () => {
      invalidate()
      toast.success(t('graded'))
      onGraded()
    },
    onError: (e) => errorToast.show(e),
  })
  const back = useMutation({
    mutationFn: () => returnSubmissionRequest(submission.id, { feedback: feedback.trim() }),
    onSuccess: () => {
      invalidate()
      toast.success(t('returned'))
      onGraded()
    },
    onError: (e) => errorToast.show(e),
  })

  function onGrade() {
    if (score === '' || Number.isNaN(Number(score))) {
      toast.error(t('scoreRequired'))
      return
    }
    grade.mutate()
  }
  function onReturn() {
    if (!feedback.trim()) {
      toast.error(t('feedbackRequired'))
      return
    }
    back.mutate()
  }

  const submittedAt = submission.submittedAt
    ? new Date(submission.submittedAt).toLocaleString(locale, {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  return (
    <Modal
      onClose={onClose}
      title={`${submission.student.firstName} ${submission.student.lastName}`}
    >
      <div className="flex flex-col gap-4">
        {/* Сама работа: попытка, время сдачи, текст и ссылка. */}
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">
            {t('attempt', { n: submission.attemptNumber })}
            {submittedAt ? ` · ${submittedAt}` : ''}
          </span>
          {submission.text ? (
            <p className="text-sm whitespace-pre-wrap">{submission.text}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noText')}</p>
          )}
          {submission.linkUrl && (
            <a
              href={submission.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm break-all text-primary hover:underline"
            >
              <Link2 className="size-4 shrink-0" aria-hidden />
              {submission.linkUrl}
            </a>
          )}
        </div>

        {/* Линия вместо второй карточки: в окне работа и оценка — один разговор,
            и рамка внутри рамки только добавляет уровней. */}
        <hr className="border-border" />

        {gradable ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="grade-score">
                {t('score')}
                {maxScore != null ? ` / ${maxScore}` : ''}
              </Label>
              <Input
                id="grade-score"
                type="number"
                value={score}
                onChange={(e) => setScore(e.target.value)}
                max={maxScore ?? undefined}
                className="w-32"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="grade-feedback">{t('feedback')}</Label>
              <Textarea
                id="grade-feedback"
                rows={4}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
              />
            </div>
          </>
        ) : (
          /*
            Работа уже закрыта — показываем итог, а не форму: пустое отключённое поле
            комментария занимало полокна и обещало ввод, которого не будет. Балл при этом
            стоял в двух местах сразу — в плашке «Уже оценено» и в поле под ней.
          */
          <div className="flex flex-col gap-3">
            <Badge variant={submission.status === 'GRADED' ? 'success' : 'warning'}>
              {submission.status === 'GRADED' ? t('sub.GRADED') : t('alreadyReturned')}
            </Badge>
            <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t('score')}</dt>
              <dd className="font-semibold tabular-nums">
                {submission.score != null
                  ? `${submission.score}${maxScore != null ? ` / ${maxScore}` : ''}`
                  : '—'}
              </dd>
              <dt className="text-muted-foreground">{t('feedback')}</dt>
              <dd className="whitespace-pre-wrap">{submission.feedback || '—'}</dd>
            </dl>
          </div>
        )}

        {/* Кнопки по краям строки, когда их три, и у правого края, когда она одна:
            одинокая кнопка слева читается как забытая. */}
        <div
          className={cn(
            'flex flex-wrap items-center gap-2',
            gradable ? 'justify-between' : 'justify-end',
          )}
        >
          <Button variant="outline" onClick={onClose}>
            {tCommon('close')}
          </Button>
          {gradable && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={onReturn}
                loading={back.isPending}
              >
                <RotateCcw className="size-4" aria-hidden />
                {t('returnForFix')}
              </Button>
              <Button className="gap-1.5" onClick={onGrade} loading={grade.isPending}>
                <CheckCircle2 className="size-4" aria-hidden />
                {t('publishGrade')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
