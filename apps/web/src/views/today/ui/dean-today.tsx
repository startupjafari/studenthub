'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { AlertTriangle, ArrowRight, CalendarDays, FileClock, FileText, Inbox } from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  MetricTile,
  PageHeader,
  SectionPanel,
  Skeleton,
} from '../../../shared/ui'
import { nowInTz, isoWeekParity } from '../../../shared/lib'
import { scheduleKeys, fetchSchedule, fetchScheduleChanges } from '../../../entities/schedule'
import { applicationKeys, fetchQueueStats } from '../../../entities/application-service'
import { notificationKeys, fetchNotifications } from '../../../entities/notification'
import { buildDayPairs } from '../lib/schedule-day'
import { PAIR_BADGE, PAIR_STATE_KEY } from './pair-visuals'
import { RecentChanges } from './recent-changes'

// «Сегодня» декана — операционный экран рабочего дня (не BI-дашборд): показатели дня,
// проблемы расписания сегодня, очередь заявок, последние изменения.
export function DeanToday() {
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
  const queue = useQuery({
    queryKey: [...applicationKeys.all, 'queue-stats'],
    queryFn: fetchQueueStats,
  })
  const notifications = useQuery({
    queryKey: notificationKeys.list(),
    queryFn: () => fetchNotifications(20),
  })

  const dayPairs = useMemo(
    () => buildDayPairs(schedule.data?.pairs ?? [], changes.data ?? [], now, parity),
    [schedule.data?.pairs, changes.data, now, parity],
  )
  const todayChanges = changes.data ?? []

  const greetingDate = useMemo(
    () => new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }),
    [locale],
  )

  if (schedule.isLoading) {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
        <PageHeader title={t('title')} subtitle={greetingDate} />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader title={t('title')} subtitle={greetingDate} />

      {/* Плитки — системные MetricTile: та же шкала, что на дашборде вуза и в обзоре
          документов. Тон несёт чип иконки, число остаётся текстовым токеном; исключение —
          «Просрочено», где тревожно само значение. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile
          icon={CalendarDays}
          label={t('kpi.classesToday')}
          value={dayPairs.length}
          href="/dean/schedule"
        />
        <MetricTile
          icon={AlertTriangle}
          tone={todayChanges.length > 0 ? 'text-warning' : 'text-muted-foreground'}
          label={t('kpi.scheduleIssues')}
          value={todayChanges.length}
          href="/dean/schedule"
        />
        <MetricTile
          icon={FileText}
          tone="text-info"
          label={t('kpi.newApplications')}
          value={queue.data?.new ?? 0}
          loading={queue.isLoading}
          href="/dean/applications"
        />
        <MetricTile
          icon={FileClock}
          tone="text-destructive"
          label={t('kpi.overdue')}
          value={queue.data?.overdue ?? 0}
          valueTone={(queue.data?.overdue ?? 0) > 0 ? 'text-destructive' : undefined}
          loading={queue.isLoading}
          href="/dean/applications"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <SectionPanel title={t('scheduleIssuesToday')} subtitle={t('scheduleIssuesTodayHint')}>
            <>
              {todayChanges.length === 0 ? (
                <EmptyState
                  icon={<AlertTriangle className="size-6" aria-hidden />}
                  title={t('noScheduleIssues')}
                  className="border-0 p-6"
                />
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {todayChanges.map((c) => {
                    const state =
                      c.type === 'CANCELLED'
                        ? 'cancelled'
                        : c.type === 'ROOM_CHANGED'
                          ? 'room'
                          : c.type === 'SUBSTITUTED'
                            ? 'substituted'
                            : 'moved'
                    return (
                      <li
                        key={c.id}
                        className="flex items-center gap-3 rounded-lg border border-border p-2.5"
                      >
                        <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">
                          {c.newStartTime ?? c.pair.startTime}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {c.pair.subject}
                          </span>
                          {c.note && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {c.note}
                            </span>
                          )}
                        </span>
                        <Badge variant={PAIR_BADGE[state]}>{t(PAIR_STATE_KEY[state])}</Badge>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          </SectionPanel>

          <SectionPanel title={t('applicationsQueue')} subtitle={t('applicationsQueueHint')}>
            <div className="flex flex-col gap-3">
              {queue.isError ? (
                <EmptyState
                  icon={<Inbox className="size-6" aria-hidden />}
                  title={t('loadError')}
                  className="border-0 p-6"
                />
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <QueueStat label={t('queue.inWork')} value={queue.data?.inWork ?? 0} />
                    <QueueStat
                      label={t('queue.actionNeeded')}
                      value={queue.data?.actionNeeded ?? 0}
                    />
                    <QueueStat label={t('queue.ready')} value={queue.data?.ready ?? 0} />
                  </div>
                  <Button asChild variant="outline" className="gap-1.5">
                    <Link href="/dean/applications">
                      {t('openQueue')}
                      <ArrowRight className="size-4" aria-hidden />
                    </Link>
                  </Button>
                </>
              )}
            </div>
          </SectionPanel>
        </div>

        <RecentChanges notifications={notifications.data ?? []} />
      </div>
    </div>
  )
}

// Мини-показатель внутри панели очереди. Не MetricTile: три плитки с чипами иконок
// внутри панели перебивают её собственную шапку — здесь нужны только числа.
// Кегль и подпись — те же, что у MetricTile, чтобы шкала не расходилась.
function QueueStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="text-xl leading-tight font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
