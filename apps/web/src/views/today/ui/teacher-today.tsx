'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { Inbox } from 'lucide-react'
import { Button, EmptyState, PageHeader, Skeleton } from '../../../shared/ui'
import { meKeys, fetchMeToday } from '../../../entities/me'
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

  // Один BFF-запрос вместо четырёх доменных (docs/UNIFIED_UX.md PR-1). Форма — по роли на бэке.
  const today = useQuery({ queryKey: meKeys.today(), queryFn: fetchMeToday })
  const now = useMemo(() => nowInTz(today.data?.timezone ?? null), [today.data?.timezone])
  const parity = useMemo(() => isoWeekParity(), [])

  const dayPairs = useMemo(
    () => buildDayPairs(today.data?.pairs ?? [], today.data?.scheduleChanges ?? [], now, parity),
    [today.data?.pairs, today.data?.scheduleChanges, now, parity],
  )
  const upcoming = useMemo(() => nextPair(dayPairs, now), [dayPairs, now])
  const attention = useMemo(
    () =>
      buildAttention({
        applications: [],
        events: today.data?.events ?? [],
        assignments: [],
        todayDate: now.date,
        locale,
      }),
    [today.data?.events, now.date, locale],
  )

  const greetingDate = useMemo(
    () => new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }),
    [locale],
  )

  if (today.isLoading) {
    return (
      <div className="flex w-full flex-col gap-6">
        <PageHeader title={t('title')} subtitle={greetingDate} />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  if (today.isError) {
    return (
      <div className="flex w-full flex-col gap-6">
        <PageHeader title={t('title')} subtitle={greetingDate} />
        <EmptyState
          icon={<Inbox />}
          title={t('loadError')}
          action={<Button onClick={() => today.refetch()}>{t('retry')}</Button>}
        />
      </div>
    )
  }

  return (
    <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
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
        <RecentChanges notifications={today.data?.notifications ?? []} />
      </aside>
    </div>
  )
}
