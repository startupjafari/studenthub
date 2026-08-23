'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ArrowLeft, CheckCircle2, ClipboardCheck, Inbox, Link2, RotateCcw } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Skeleton,
  Textarea,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { toApiError, useMediaQuery } from '../../../shared/lib'
import {
  assignmentKeys,
  fetchAssignment,
  fetchSubmissions,
  gradeSubmissionRequest,
  returnSubmissionRequest,
  type SubmissionItem,
  type SubmissionStatus,
} from '../../../entities/assignment'

interface Props {
  assignmentId: string
  onBack: () => void
}

const SUB_BADGE: Record<SubmissionStatus, 'secondary' | 'info' | 'success' | 'warning'> = {
  DRAFT: 'secondary',
  SUBMITTED: 'info',
  GRADED: 'success',
  RETURNED: 'warning',
}

// Workspace проверки (задача 4). Desktop — split-view (список сдач | работа + оценка),
// mobile — последовательно (список → работа/оценка с кнопкой «назад»).
export function GradingWorkspace({ assignmentId, onBack }: Props) {
  const t = useTranslations('Assignments')
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  const assignment = useQuery({
    queryKey: assignmentKeys.detail(assignmentId),
    queryFn: () => fetchAssignment(assignmentId),
  })
  const subs = useQuery({
    queryKey: assignmentKeys.submissions(assignmentId),
    queryFn: () => fetchSubmissions(assignmentId),
  })

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const list = useMemo(() => subs.data ?? [], [subs.data])
  const selected = list.find((s) => s.id === selectedId) ?? null

  // Автовыбор первой работы на десктопе.
  useEffect(() => {
    if (isDesktop && !selectedId && list.length > 0) setSelectedId(list[0]!.id)
  }, [isDesktop, selectedId, list])

  function selectNext(afterId: string) {
    const idx = list.findIndex((s) => s.id === afterId)
    const next = list.slice(idx + 1).find((s) => s.status === 'SUBMITTED')
    setSelectedId(next?.id ?? (isDesktop ? afterId : null))
  }

  const header = (
    <PageHeader
      title={assignment.data?.title ?? t('grading')}
      subtitle={
        assignment.data
          ? `${assignment.data.course.subject.name} · ${assignment.data.course.group.name}`
          : undefined
      }
      onBack={onBack}
      backLabel={t('back')}
    />
  )

  if (subs.isLoading) {
    return (
      <div className="flex w-full flex-col gap-4">
        {header}
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    )
  }

  if (list.length === 0) {
    return (
      <div className="flex w-full flex-col gap-4">
        {header}
        <EmptyState
          icon={<Inbox />}
          title={t('noSubmissions')}
          description={t('noSubmissionsHint')}
        />
      </div>
    )
  }

  const listPanel = (
    <SubmissionsList items={list} selectedId={selectedId} onSelect={setSelectedId} t={t} />
  )

  const detailPanel = selected ? (
    <GradePanel
      key={selected.id}
      assignmentId={assignmentId}
      maxScore={assignment.data?.maxScore ?? null}
      submission={selected}
      onGraded={() => selectNext(selected.id)}
      onBackToList={isDesktop ? undefined : () => setSelectedId(null)}
      t={t}
    />
  ) : null

  // Mobile: список ИЛИ выбранная работа.
  if (!isDesktop) {
    return (
      <div className="flex w-full flex-col gap-4">
        {header}
        {selected ? detailPanel : listPanel}
      </div>
    )
  }

  // Desktop: split-view.
  return (
    <div className="flex w-full flex-col gap-4">
      {header}
      <div className="grid grid-cols-[18rem_minmax(0,1fr)] gap-4">
        {listPanel}
        <div className="min-w-0">{detailPanel}</div>
      </div>
    </div>
  )
}

function SubmissionsList({
  items,
  selectedId,
  onSelect,
  t,
}: {
  items: SubmissionItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <Card>
      <CardContent className="p-2">
        <ul className="flex flex-col gap-1">
          {items.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg p-2 text-left transition-colors outline-none focus-visible:ring-4 focus-visible:ring-ring/20',
                  selectedId === s.id ? 'bg-primary/[0.08]' : 'hover:bg-muted/50',
                )}
              >
                <Avatar className="size-8">
                  <AvatarFallback>
                    {s.student.firstName[0]}
                    {s.student.lastName[0]}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {s.student.firstName} {s.student.lastName}
                </span>
                {s.status === 'GRADED' && s.score != null ? (
                  <span className="shrink-0 text-xs font-semibold text-success tabular-nums">
                    {s.score}
                  </span>
                ) : (
                  <Badge variant={SUB_BADGE[s.status]} className="shrink-0">
                    {t(`sub.${s.status}`)}
                  </Badge>
                )}
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function GradePanel({
  assignmentId,
  maxScore,
  submission,
  onGraded,
  onBackToList,
  t,
}: {
  assignmentId: string
  maxScore: number | null
  submission: SubmissionItem
  onGraded: () => void
  onBackToList?: () => void
  t: ReturnType<typeof useTranslations>
}) {
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
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
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })
  const back = useMutation({
    mutationFn: () => returnSubmissionRequest(submission.id, { feedback: feedback.trim() }),
    onSuccess: () => {
      invalidate()
      toast.success(t('returned'))
      onGraded()
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
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

  return (
    <div className="flex flex-col gap-4">
      {onBackToList && (
        <Button variant="ghost" size="sm" className="w-fit gap-1.5" onClick={onBackToList}>
          <ArrowLeft className="size-4" aria-hidden />
          {t('toList')}
        </Button>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="font-heading text-sm font-semibold">
              {submission.student.firstName} {submission.student.lastName}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('attempt', { n: submission.attemptNumber })}
              {submission.submittedAt
                ? ` · ${new Date(submission.submittedAt).toLocaleString(locale, {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : ''}
            </span>
          </div>
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
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 p-4">
          <h3 className="flex items-center gap-2 font-heading text-sm font-semibold">
            <ClipboardCheck className="size-4 text-primary" aria-hidden />
            {t('gradePanel')}
          </h3>

          {!gradable && submission.status === 'GRADED' && (
            <div className="flex items-center gap-2 rounded-lg bg-success/10 p-3 text-sm text-success">
              <CheckCircle2 className="size-4" aria-hidden />
              {t('alreadyGraded', { score: submission.score ?? 0 })}
            </div>
          )}
          {!gradable && submission.status === 'RETURNED' && (
            <div className="rounded-lg bg-warning/10 p-3 text-sm text-warning-foreground dark:text-warning">
              {t('alreadyReturned')}
            </div>
          )}

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
              disabled={!gradable}
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
              disabled={!gradable}
            />
          </div>

          {gradable && (
            <div className="flex flex-wrap justify-end gap-2">
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
        </CardContent>
      </Card>
    </div>
  )
}
