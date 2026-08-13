'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarClock, ChevronRight, ClipboardList, Inbox } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Skeleton,
} from '../../../shared/ui'
import {
  assignmentKeys,
  fetchAssignments,
  fetchAssignment,
  type AssignmentItem,
} from '../../../entities/assignment'
import { studentStatus, STUDENT_STATUS_BADGE, STUDENT_STATUS_KEY } from '../lib/assignment-status'
import { StudentAssignmentDetail } from './student-assignment-detail'

// «Задания» студента (задача 3): список + деталь/сдача (экранное состояние, как в «Заявках»).
export function StudentAssignmentsView() {
  const t = useTranslations('Assignments')
  // Диплинк из курса/поиска: /assignments?open=<id> сразу раскрывает деталь задания
  // (детали живут экранным состоянием, отдельного роута /assignments/[id] нет).
  const searchParams = useSearchParams()
  const [openId, setOpenId] = useState<string | null>(() => searchParams.get('open'))
  const qc = useQueryClient()

  const q = useQuery({ queryKey: assignmentKeys.list(), queryFn: () => fetchAssignments() })

  // Prefetch детали задания при наведении/фокусе строки (принцип 3): к клику деталь уже в кэше,
  // экран открывается мгновенно. staleTime гасит повторные prefetch по одному id.
  const prefetch = (id: string): void => {
    void qc.prefetchQuery({
      queryKey: assignmentKeys.detail(id),
      queryFn: () => fetchAssignment(id),
      staleTime: 30_000,
    })
  }

  if (openId) {
    return <StudentAssignmentDetail id={openId} onBack={() => setOpenId(null)} />
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title={t('title')} />

      {q.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : q.isError ? (
        <EmptyState
          icon={<Inbox />}
          title={t('loadError')}
          action={<Button onClick={() => q.refetch()}>{t('retry')}</Button>}
        />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState icon={<ClipboardList />} title={t('empty')} description={t('emptyHint')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {(q.data ?? []).map((a) => (
            <li key={a.id}>
              <AssignmentRow
                assignment={a}
                onOpen={() => setOpenId(a.id)}
                onPrefetch={() => prefetch(a.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AssignmentRow({
  assignment: a,
  onOpen,
  onPrefetch,
}: {
  assignment: AssignmentItem
  onOpen: () => void
  onPrefetch: () => void
}) {
  const t = useTranslations('Assignments')
  const locale = useLocale()
  const st = studentStatus(a)

  return (
    <Card className="transition-colors hover:bg-muted/40">
      <CardContent className="p-0">
        <button
          type="button"
          onClick={onOpen}
          onMouseEnter={onPrefetch}
          onFocus={onPrefetch}
          className="flex w-full items-center gap-3 p-3.5 text-left outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ClipboardList className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{a.title}</span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="truncate">{a.course.subject.name}</span>
              {a.dueAt && (
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="size-3" aria-hidden />
                  {new Date(a.dueAt).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
                </span>
              )}
            </span>
          </span>
          {st === 'GRADED' && a.mySubmission?.score != null && (
            <span className="shrink-0 font-heading text-sm font-semibold text-success tabular-nums">
              {a.mySubmission.score}
              {a.maxScore != null ? `/${a.maxScore}` : ''}
            </span>
          )}
          <Badge variant={STUDENT_STATUS_BADGE[st]} className="shrink-0">
            {t(STUDENT_STATUS_KEY[st])}
          </Badge>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </CardContent>
    </Card>
  )
}
