'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  ClipboardList,
  FileClock,
  FileText,
  Inbox,
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
      <div className="flex w-full flex-col gap-6">
        <PageHeader title={t('title')} subtitle={greetingDate} />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title={t('title')} subtitle={greetingDate} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          icon={CalendarDays}
          label={t('kpi.classesToday')}
          value={dayPairs.length}
          href="/dean/schedule"
        />
        <StatTile
          icon={AlertTriangle}
          label={t('kpi.scheduleIssues')}
          value={todayChanges.length}
          tone={todayChanges.length > 0 ? 'warning' : 'default'}
          href="/dean/schedule"
        />
        <StatTile
          icon={FileText}
          label={t('kpi.newApplications')}
          value={queue.data?.new ?? 0}
          href="/dean/applications"
        />
        <StatTile
          icon={FileClock}
          label={t('kpi.overdue')}
          value={queue.data?.overdue ?? 0}
          tone={(queue.data?.overdue ?? 0) > 0 ? 'destructive' : 'default'}
          href="/dean/applications"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="size-4 text-primary" aria-hidden />
                {t('scheduleIssuesToday')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {todayChanges.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noScheduleIssues')}</p>
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="size-4 text-primary" aria-hidden />
                {t('applicationsQueue')}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {queue.isError ? (
                <EmptyState icon={<Inbox />} title={t('loadError')} />
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
            </CardContent>
          </Card>
        </div>

        <RecentChanges notifications={notifications.data ?? []} />
      </div>
    </div>
  )
}

function StatTile({
  icon: Icon,
  label,
  value,
  href,
  tone = 'default',
}: {
  icon: LucideIcon
  label: string
  value: number
  href: string
  tone?: 'default' | 'warning' | 'destructive'
}) {
  const toneCls =
    tone === 'destructive'
      ? 'text-destructive'
      : tone === 'warning'
        ? 'text-warning-foreground dark:text-warning'
        : 'text-foreground'
  return (
    <Link href={href}>
      <Card className="transition-colors hover:bg-muted/40">
        <CardContent className="flex flex-col gap-1 p-4">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          <span className={`font-heading text-2xl font-semibold tabular-nums ${toneCls}`}>
            {value}
          </span>
          <span className="text-xs text-muted-foreground">{label}</span>
        </CardContent>
      </Card>
    </Link>
  )
}

function QueueStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="font-heading text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
