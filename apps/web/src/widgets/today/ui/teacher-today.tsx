'use client'

import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { Inbox } from 'lucide-react'
import { Button, EmptyState, PageHeader, SeasonGreeting, Skeleton } from '../../../shared/ui'
import { meKeys, fetchMeToday } from '../../../entities/me'
import { useRealtimeEvent } from '../../../shared/realtime'
import { buildDayPairs, isoWeekParity, nextPair, nowInTz } from '../lib/schedule-day'
import { buildAttention } from '../lib/attention'
import { NextPairCard } from './next-pair-card'
import { TodayTimeline } from './today-timeline'
import { AttentionList } from './attention-list'
import { RecentChanges } from './recent-changes'
import {
  AttendanceTodoPanel,
  ReviewQueuePanel,
  TeacherQuickActions,
  UpcomingConsultationsPanel,
} from './teacher-actions'

const TEACHER_QUICK_LINKS = [
  { key: 'quick.materials', href: '/teacher/materials' },
  { key: 'quick.groupChat', href: '/teacher/chats' },
]

// Рабочий экран дня преподавателя: занятия на сегодня (свои пары), timeline,
// ближайшие события и последние изменения. Проверка работ/журнал появятся с
// доменом заданий (следующие фазы) — здесь используем существующие данные.
//
// Это же и есть его «Дашборд»: отдельного пункта «Сегодня» в навигации больше нет,
// а на месте дашборда стояли плитки-ссылки, повторявшие сайдбар.
export function TeacherToday() {
  const t = useTranslations('Today')
  // Заголовок — «Дашборд»: экран открывается из этого пункта навигации, и подпись
  // должна совпадать с тем, по чему на него пришли. День остаётся в подзаголовке.
  const tNav = useTranslations('Nav')
  const locale = useLocale()

  // Один BFF-запрос вместо четырёх доменных (docs/UNIFIED_UX.md PR-1). Форма — по роли на бэке.
  const qc = useQueryClient()
  const today = useQuery({ queryKey: meKeys.today(), queryFn: fetchMeToday })

  // Realtime: изменение расписания незаметно обновляет «Сегодня» (без опроса).
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
      <div className="flex w-full flex-1 flex-col gap-4">
        <PageHeader title={tNav('dashboard')} subtitle={greetingDate} />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  if (today.isError) {
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        <PageHeader title={tNav('dashboard')} subtitle={greetingDate} />
        <EmptyState
          icon={<Inbox />}
          title={t('loadError')}
          action={<Button onClick={() => today.refetch()}>{t('retry')}</Button>}
        />
      </div>
    )
  }

  return (
    // Шапка — НАД сеткой, а не внутри левой колонки: раньше правая колонка начиналась
    // на высоте заголовка, то есть выше левой, и верхние края карточек не совпадали.
    // Это же каркас страницы из §10.1.
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader title={tNav('dashboard')} subtitle={greetingDate} />
      <SeasonGreeting />
      <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="flex min-w-0 flex-col gap-4">
          <NextPairCard
            dayPair={upcoming}
            dayEmpty={dayPairs.length === 0}
            showTeacher={false}
            scheduleHref="/teacher/schedule"
            quickLinks={TEACHER_QUICK_LINKS}
          />
          {/* Обязанности со сроком — сразу под ближайшей парой: расписание и уведомления
              говорят, ЧТО происходит, а эти две панели — что нужно сделать. */}
          <AttendanceTodoPanel dayPairs={dayPairs} date={now.date} now={now} />
          <ReviewQueuePanel />
          <AttentionList items={attention} />
        </section>
        <aside className="flex flex-col gap-4">
          <TeacherQuickActions />
          <UpcomingConsultationsPanel />
          {/* Пустой день не показываем дважды: слева уже стоит крупная карточка «пар
              больше нет», и панель расписания под ней повторяла бы ту же мысль вторым
              пустым состоянием. Когда пары есть, панели отвечают на разные вопросы —
              «что ближайшее» и «как выглядит весь день», — и обе нужны. */}
          {dayPairs.length > 0 && <TodayTimeline dayPairs={dayPairs} showTeacher={false} />}
          <RecentChanges notifications={today.data?.notifications ?? []} />
        </aside>
      </div>
    </div>
  )
}
