'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { Inbox } from 'lucide-react'
import { Button, EmptyState, PageHeader, Skeleton } from '../../../shared/ui'
import { scheduleKeys, fetchSchedule, fetchScheduleChanges } from '../../../entities/schedule'
import { eventKeys, fetchEvents } from '../../../entities/event'
import { notificationKeys, fetchNotifications } from '../../../entities/notification'
import { buildDayPairs, isoWeekParity, nextPair, nowInTz } from '../lib/schedule-day'
import { buildAttention } from '../lib/attention'
import { NextPairCard } from './next-pair-card'
import { TodayTimeline } from './today-timeline'
import { AttentionList } from './attention-list'
import { RecentChanges } from './recent-changes'

const TEACHER_QUICK_LINKS = [
  { key: 'quick.materials', href: '/teacher/materials' },
  { key: 'quick.groupChat', href: '/teacher/chats' },
]

// Экран «Сегодня» преподавателя: занятия на сегодня (свои пары), timeline,
// ближайшие события и последние изменения. Проверка работ/журнал появятся с
// доменом заданий (следующие фазы) — здесь используем существующие данные.
export function TeacherToday() {
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

  const events = useQuery({
    queryKey: eventKeys.list('upcoming'),
    queryFn: () => fetchEvents({ limit: 20, filter: 'upcoming' }),
  })

  const notifications = useQuery({
    queryKey: notificationKeys.list(),
    queryFn: () => fetchNotifications(20),
  })

  const dayPairs = useMemo(
    () => buildDayPairs(schedule.data?.pairs ?? [], changes.data ?? [], now, parity),
    [schedule.data?.pairs, changes.data, now, parity],
  )
  const upcoming = useMemo(() => nextPair(dayPairs, now), [dayPairs, now])
  const attention = useMemo(
    () =>
      buildAttention({
        applications: [],
        events: events.data ?? [],
        assignments: [],
        todayDate: now.date,
        locale,
      }),
    [events.data, now.date, locale],
  )

  const greetingDate = useMemo(
    () => new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }),
    [locale],
  )

  if (schedule.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6">
        <PageHeader title={t('title')} subtitle={greetingDate} />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  if (schedule.isError) {
    return (
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6">
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
    <div className="mx-auto grid w-full max-w-[1120px] grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="flex min-w-0 flex-col gap-4">
        <PageHeader title={t('title')} subtitle={greetingDate} />
        <NextPairCard
          dayPair={upcoming}
          showTeacher={false}
          scheduleHref="/teacher/schedule"
          quickLinks={TEACHER_QUICK_LINKS}
        />
        <AttentionList items={attention} />
      </section>
      <aside className="flex flex-col gap-4">
        <TodayTimeline dayPairs={dayPairs} showTeacher={false} />
        <RecentChanges notifications={notifications.data ?? []} />
      </aside>
    </div>
  )
}
