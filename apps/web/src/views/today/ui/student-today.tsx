'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { Inbox } from 'lucide-react'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  PageHeader,
  Skeleton,
} from '../../../shared/ui'
import { scheduleKeys, fetchSchedule, fetchScheduleChanges } from '../../../entities/schedule'
import { applicationKeys, fetchApplications } from '../../../entities/application-service'
import { eventKeys, fetchEvents } from '../../../entities/event'
import { notificationKeys, fetchNotifications } from '../../../entities/notification'
import { assignmentKeys, fetchAssignments } from '../../../entities/assignment'
import { buildDayPairs, isoWeekParity, nextPair, nowInTz } from '../lib/schedule-day'
import { buildAttention } from '../lib/attention'
import { NextPairCard } from './next-pair-card'
import { TodayTimeline } from './today-timeline'
import { AttentionList } from './attention-list'
import { RecentChanges } from './recent-changes'

// Быстрые действия героя — только существующие разделы (без мёртвых ссылок).
const STUDENT_QUICK_LINKS = [
  { key: 'quick.groupChat', href: '/chats' },
  { key: 'quick.events', href: '/events' },
]

// Экран «Сегодня» студента: следующая пара, timeline дня, «требует внимания»
// (заявки + события) и последние важные изменения. Всё — из существующих API.
export function StudentToday() {
  const t = useTranslations('Today')
  const locale = useLocale()

  const schedule = useQuery({ queryKey: scheduleKeys.view({}), queryFn: () => fetchSchedule({}) })

  const now = useMemo(() => nowInTz(schedule.data?.timezone ?? null), [schedule.data?.timezone])
  const parity = useMemo(() => isoWeekParity(), [])

  const changes = useQuery({
    queryKey: scheduleKeys.changes({ from: now.date, to: now.date }),
    queryFn: () => fetchScheduleChanges({ from: now.date, to: now.date }),
    enabled: !!schedule.data,
  })

  const applications = useQuery({
    queryKey: applicationKeys.list({ limit: 50 }),
    queryFn: () => fetchApplications({ limit: 50 }),
  })

  const events = useQuery({
    queryKey: eventKeys.list('upcoming'),
    queryFn: () => fetchEvents({ limit: 20, filter: 'upcoming' }),
  })

  const notifications = useQuery({
    queryKey: notificationKeys.list(),
    queryFn: () => fetchNotifications(20),
  })
  const assignments = useQuery({
    queryKey: assignmentKeys.list(),
    queryFn: () => fetchAssignments(),
    retry: false,
  })

  const dayPairs = useMemo(
    () => buildDayPairs(schedule.data?.pairs ?? [], changes.data ?? [], now, parity),
    [schedule.data?.pairs, changes.data, now, parity],
  )
  const upcoming = useMemo(() => nextPair(dayPairs, now), [dayPairs, now])

  const attention = useMemo(
    () =>
      buildAttention({
        applications: applications.data?.items ?? [],
        events: events.data ?? [],
        assignments: assignments.data ?? [],
        todayDate: now.date,
        locale,
      }),
    [applications.data, events.data, assignments.data, now.date, locale],
  )

  const greetingDate = useMemo(
    () => new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }),
    [locale],
  )

  if (schedule.isLoading) {
    return (
      <div className="flex w-full flex-col gap-6">
        <PageHeader title={t('title')} subtitle={greetingDate} />
        <TodaySkeleton />
      </div>
    )
  }

  if (schedule.isError) {
    return (
      <div className="flex w-full flex-col gap-6">
        <PageHeader title={t('title')} subtitle={greetingDate} />
        <EmptyState
          icon={<Inbox />}
          title={t('loadError')}
          action={<Button onClick={() => schedule.refetch()}>{t('retry')}</Button>}
        />
      </div>
    )
  }

  return (
    <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="flex min-w-0 flex-col gap-4">
        <PageHeader title={t('title')} subtitle={greetingDate} />
        <NextPairCard dayPair={upcoming} quickLinks={STUDENT_QUICK_LINKS} />
        <AttentionList items={attention} />
      </section>
      <aside className="flex flex-col gap-4">
        <TodayTimeline dayPairs={dayPairs} />
        <RecentChanges notifications={notifications.data ?? []} />
      </aside>
    </div>
  )
}

function TodaySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    </div>
  )
}
