'use client'

import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
import { meKeys, fetchMeToday } from '../../../entities/me'
import { useRealtimeEvent } from '../../../shared/realtime'
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

  const qc = useQueryClient()

  // Один BFF-запрос вместо шести доменных (docs/UNIFIED_UX.md PR-1). Форма — по роли на бэке.
  const today = useQuery({ queryKey: meKeys.today(), queryFn: fetchMeToday })

  // Realtime: изменение расписания приходит по WS — обновляем «Сегодня» незаметно, без опроса.
  // Подписываемся только на schedule:changed (самое время-чувствительное для таймлайна);
  // на каждый notification:new НЕ рефетчим агрегат — колокольчик обновляется сам.
  useRealtimeEvent('schedule:changed', () => {
    void qc.invalidateQueries({ queryKey: meKeys.today() })
  })

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
        applications: today.data?.applications ?? [],
        events: today.data?.events ?? [],
        assignments: today.data?.assignments ?? [],
        todayDate: now.date,
        locale,
      }),
    [today.data?.applications, today.data?.events, today.data?.assignments, now.date, locale],
  )

  const greetingDate = useMemo(
    () => new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }),
    [locale],
  )

  if (today.isLoading) {
    return (
      <div className="flex w-full flex-col gap-6">
        <PageHeader title={t('title')} subtitle={greetingDate} />
        <TodaySkeleton />
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
        <NextPairCard dayPair={upcoming} quickLinks={STUDENT_QUICK_LINKS} />
        <AttentionList items={attention} />
      </section>
      <aside className="flex flex-col gap-4">
        <TodayTimeline dayPairs={dayPairs} />
        <RecentChanges notifications={today.data?.notifications ?? []} />
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
