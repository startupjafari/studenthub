'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { AlertTriangle, CalendarDays, FileClock, FileText } from 'lucide-react'
import { Badge, EmptyState, MetricTile, SectionPanel, Skeleton } from '../../../shared/ui'
import { nowInTz, isoWeekParity } from '../../../shared/lib'
import { scheduleKeys, fetchSchedule, fetchScheduleChanges } from '../../../entities/schedule'
import { applicationKeys, fetchQueueStats } from '../../../entities/application-service'
import { notificationKeys, fetchNotifications } from '../../../entities/notification'
import { buildDayPairs } from '../lib/schedule-day'
import { PAIR_BADGE, PAIR_STATE_KEY } from './pair-visuals'
import { RecentChanges } from './recent-changes'

/**
 * Операционный блок рабочего дня декана: показатели дня, проблемы расписания на
 * сегодня и последние изменения.
 *
 * Это верхняя половина дашборда, а не отдельный экран. Раньше «Сегодня» и «Дашборд»
 * стояли в навигации порознь и отвечали на соседние вопросы — «что сегодня не так» и
 * «как дела на факультете», — а начинать рабочий день приходилось с выбора между ними.
 * Поэтому здесь нет ни шапки страницы, ни внешней обёртки: их даёт дашборд.
 *
 * Панели очереди заявок тут тоже нет: на дашборде ниже стоит её же разрез графиком, и
 * притом подробнее (пять состояний против трёх). Кнопка «Открыть очередь» переехала
 * туда же — в шапку той панели.
 */
export function DeanTodayBlock() {
  const t = useTranslations('Today')

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

  if (schedule.isLoading) {
    return <Skeleton className="h-24 w-full rounded-xl" />
  }

  return (
    <>
      {/* Плитки — системные MetricTile: та же шкала, что на дашборде вуза и в обзоре
          документов. Тон несёт чип иконки, число остаётся текстовым токеном; исключение —
          «Просрочено», где тревожно само значение. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile
          index={0}
          icon={CalendarDays}
          label={t('kpi.classesToday')}
          value={dayPairs.length}
          href="/dean/schedule"
        />
        <MetricTile
          index={1}
          icon={AlertTriangle}
          tone={todayChanges.length > 0 ? 'text-warning' : 'text-muted-foreground'}
          label={t('kpi.scheduleIssues')}
          value={todayChanges.length}
          href="/dean/schedule"
        />
        <MetricTile
          index={2}
          icon={FileText}
          tone="text-info"
          label={t('kpi.newApplications')}
          value={queue.data?.new ?? 0}
          loading={queue.isLoading}
          href="/dean/applications"
        />
        <MetricTile
          index={3}
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
                        <span className="block truncate text-sm font-medium">{c.pair.subject}</span>
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

        <RecentChanges notifications={notifications.data ?? []} />
      </div>
    </>
  )
}
