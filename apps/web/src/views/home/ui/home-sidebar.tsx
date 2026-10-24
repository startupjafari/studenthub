'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarClock, CalendarDays, MapPin, Video } from 'lucide-react'
import {
  buildDayPairs,
  fetchSchedule,
  fetchScheduleChanges,
  scheduleKeys,
  type ScheduleChangeType,
} from '../../../entities/schedule'
import { eventKeys, fetchEvents } from '../../../entities/event'
import { FriendsPanel } from '../../../widgets/friends-panel'
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from '../../../shared/ui'
import { isoWeekParityOf, useNowInTz } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'

// Подпись изменения пары — ключи состояний «Сегодня» (Today.state.*).
const CHANGE_STATE_KEY: Record<ScheduleChangeType, string> = {
  CANCELLED: 'state.cancelled',
  MOVED: 'state.moved',
  ROOM_CHANGED: 'state.roomChanged',
  SUBSTITUTED: 'state.substituted',
}

// Виджеты правой колонки главной студента: пары на сегодня, ближайшие события и друзья.
export function HomeSidebar() {
  const t = useTranslations('Dashboard')
  const tToday = useTranslations('Today')
  const locale = useLocale()

  const schedQ = useQuery({ queryKey: scheduleKeys.view({}), queryFn: () => fetchSchedule({}) })
  // День, чётность и «сейчас» — по часам вуза, с изменениями на сегодня (как в «Сегодня»):
  // раньше отменённая пара стояла в списке, а у перенесённой было старое время.
  const now = useNowInTz(schedQ.data?.timezone ?? null)
  const changesQ = useQuery({
    queryKey: scheduleKeys.changes({ from: now.date, to: now.date }),
    queryFn: () => fetchScheduleChanges({ from: now.date, to: now.date }),
    enabled: !!schedQ.data,
  })
  const eventsQ = useQuery({
    queryKey: eventKeys.list('upcoming', false, 4),
    queryFn: () => fetchEvents({ limit: 4 }),
  })

  const todayPairs = useMemo(
    () =>
      buildDayPairs(schedQ.data?.pairs ?? [], changesQ.data ?? [], now, isoWeekParityOf(now.date)),
    [schedQ.data?.pairs, changesQ.data, now],
  )
  const events = (eventsQ.data ?? []).slice(0, 4)

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="size-4 text-primary" aria-hidden />
            {t('scheduleToday')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {schedQ.isLoading ? (
            <Skeleton fill className="min-h-16 rounded-lg" />
          ) : todayPairs.length === 0 ? (
            <EmptyState title={t('noPairsToday')} className="border-0 p-6" />
          ) : (
            <ul className="flex flex-col gap-2">
              {todayPairs.map(({ pair, change, state }) => {
                const cancelled = state === 'cancelled'
                const room = change?.newRoom ?? pair.room
                const changeKey = change ? CHANGE_STATE_KEY[change.type] : null
                return (
                  <li key={pair.id} className="flex items-start gap-2 text-sm">
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {change?.newStartTime ?? pair.startTime}
                    </span>
                    <div className="min-w-0">
                      <span
                        className={cn(
                          'block truncate font-medium',
                          cancelled && 'text-muted-foreground line-through',
                        )}
                      >
                        {pair.subject}
                      </span>
                      {changeKey && (
                        <span
                          className={cn(
                            'block text-xs font-medium',
                            cancelled ? 'text-destructive' : 'text-warning',
                          )}
                        >
                          {tToday(changeKey)}
                        </span>
                      )}
                      {room && !cancelled && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="size-3" aria-hidden />
                          {room.name}
                        </span>
                      )}
                    </div>
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
            <CalendarClock className="size-4 text-primary" aria-hidden />
            {t('upcomingEvents')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {eventsQ.isLoading ? (
            <Skeleton fill className="min-h-16 rounded-lg" />
          ) : events.length === 0 ? (
            <EmptyState title={t('noUpcomingEvents')} className="border-0 p-6" />
          ) : (
            <ul className="flex flex-col gap-3">
              {events.map((e) => (
                <li key={e.id} className="flex flex-col gap-0.5 text-sm">
                  <span className="truncate font-medium">{e.title}</span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {new Date(e.startsAt).toLocaleString(locale, {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {e.isOnline ? (
                      <span className="inline-flex items-center gap-1">
                        <Video className="size-3" aria-hidden />
                        {t('online')}
                      </span>
                    ) : (
                      e.location && (
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <MapPin className="size-3 shrink-0" aria-hidden />
                          <span className="truncate">{e.location}</span>
                        </span>
                      )
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Друзья и заявки — тот же блок, что и на странице «Посты»: у студента лента живёт
          здесь, и колонка должна быть одинаковой в обоих местах. Сам себя не показывает,
          пока друзей и заявок нет. */}
      <FriendsPanel />
    </>
  )
}
