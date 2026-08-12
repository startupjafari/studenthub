'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardList,
  FileText,
  Inbox,
  PackageCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Skeleton,
} from '../../../shared/ui'
import { nowInTz } from '../../../shared/lib'
import { scheduleKeys, fetchSchedule } from '../../../entities/schedule'
import { applicationKeys, fetchApplications } from '../../../entities/application-service'
import { eventKeys, fetchEvents } from '../../../entities/event'
import { assignmentKeys, fetchAssignments } from '../../../entities/assignment'
import {
  buildTasks,
  groupTasks,
  TASK_BUCKET_ORDER,
  type TaskBucket,
  type TaskItem,
  type TaskKind,
} from '../lib/tasks'

const KIND_ICON: Record<TaskKind, LucideIcon> = {
  submitApplication: FileText,
  correctApplication: FileText,
  pickupDocument: PackageCheck,
  applicationDone: FileText,
  attendEvent: CalendarClock,
  assignmentDue: ClipboardList,
  assignmentFix: ClipboardList,
  assignmentDone: ClipboardList,
}

const BUCKET_BADGE: Record<
  TaskBucket,
  'destructive' | 'warning' | 'info' | 'secondary' | 'success'
> = {
  urgent: 'destructive',
  today: 'warning',
  week: 'info',
  later: 'secondary',
  done: 'success',
}

// «Мои задачи» — авто-todo из заявок и событий, сгруппированный по срокам.
export function TasksView() {
  const t = useTranslations('Tasks')
  const locale = useLocale()

  const schedule = useQuery({ queryKey: scheduleKeys.view({}), queryFn: () => fetchSchedule({}) })
  const applications = useQuery({
    queryKey: applicationKeys.list({ limit: 50 }),
    queryFn: () => fetchApplications({ limit: 50 }),
  })
  const events = useQuery({
    queryKey: eventKeys.list('upcoming'),
    queryFn: () => fetchEvents({ limit: 30, filter: 'upcoming' }),
  })
  const assignments = useQuery({
    queryKey: assignmentKeys.list(),
    queryFn: () => fetchAssignments(),
    retry: false,
  })

  const todayDate = useMemo(
    () => nowInTz(schedule.data?.timezone ?? null).date,
    [schedule.data?.timezone],
  )

  const groups = useMemo(() => {
    const items = buildTasks({
      applications: applications.data?.items ?? [],
      events: events.data ?? [],
      assignments: assignments.data ?? [],
      todayDate,
      locale,
    })
    return groupTasks(items)
  }, [applications.data, events.data, assignments.data, todayDate, locale])

  const isLoading = applications.isLoading || events.isLoading
  const isError = applications.isError || events.isError
  const total = TASK_BUCKET_ORDER.reduce((n, b) => n + groups[b].length, 0)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : isError ? (
        <EmptyState
          icon={<Inbox />}
          title={t('loadError')}
          action={
            <Button
              onClick={() => {
                applications.refetch()
                events.refetch()
              }}
            >
              {t('retry')}
            </Button>
          }
        />
      ) : total === 0 ? (
        <EmptyState icon={<CheckCircle2 />} title={t('empty')} description={t('emptyHint')} />
      ) : (
        <div className="flex flex-col gap-4">
          {TASK_BUCKET_ORDER.filter((b) => groups[b].length > 0).map((b) => (
            <Card key={b}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {t(`bucket.${b}`)}
                  <Badge variant={BUCKET_BADGE[b]}>{groups[b].length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-1.5">
                  {groups[b].map((task) => (
                    <TaskRow key={task.id} task={task} locale={locale} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function TaskRow({ task, locale }: { task: TaskItem; locale: string }) {
  const t = useTranslations('Tasks')
  const Icon = KIND_ICON[task.kind]
  const due = task.dueAt
    ? new Date(task.dueAt).toLocaleDateString(locale, { day: '2-digit', month: 'short' })
    : null

  return (
    <li>
      <Link
        href={task.href}
        className="flex items-center gap-3 rounded-lg border border-border bg-card p-2.5 transition-colors hover:bg-muted/50"
      >
        <span className="shrink-0">
          {task.done ? (
            <CheckCircle2 className="size-5 text-success" aria-hidden />
          ) : (
            <Circle className="size-5 text-muted-foreground" aria-hidden />
          )}
        </span>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={
              'block truncate text-sm font-medium' + (task.done ? ' text-muted-foreground' : '')
            }
          >
            {task.title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {t(`kind.${task.kind}`)}
            {due ? ` · ${due}` : ''}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  )
}
