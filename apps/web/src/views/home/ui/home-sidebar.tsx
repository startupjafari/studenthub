'use client'

import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarClock, CalendarDays, MapPin, Video } from 'lucide-react'
import { scheduleKeys, fetchSchedule } from '../../../entities/schedule'
import { eventKeys, fetchEvents } from '../../../entities/event'
import { FriendsPanel } from '../../../widgets/friends-panel'
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from '../../../shared/ui'

// Чётность текущей ISO-недели (как в schedule-grid) — для выбора пар ODD/EVEN.
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 - 3) / 7)
}

// Виджеты правой колонки главной студента: пары на сегодня, ближайшие события и друзья.
export function HomeSidebar() {
  const t = useTranslations('Dashboard')
  const locale = useLocale()

  const schedQ = useQuery({ queryKey: scheduleKeys.view({}), queryFn: () => fetchSchedule({}) })
  const eventsQ = useQuery({
    queryKey: eventKeys.list('upcoming'),
    queryFn: () => fetchEvents({ limit: 4 }),
  })

  const now = new Date()
  const dow = ((now.getDay() + 6) % 7) + 1 // 1=Пн … 7=Вс
  const parity = isoWeek(now) % 2 === 1 ? 'ODD' : 'EVEN'
  const todayPairs = (schedQ.data?.pairs ?? [])
    .filter((p) => p.dayOfWeek === dow && (p.weekType === 'BOTH' || p.weekType === parity))
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
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
            <Skeleton className="h-16 w-full rounded-lg" />
          ) : todayPairs.length === 0 ? (
            <EmptyState title={t('noPairsToday')} className="border-0 p-6" />
          ) : (
            <ul className="flex flex-col gap-2">
              {todayPairs.map((p) => (
                <li key={p.id} className="flex items-start gap-2 text-sm">
                  <span className="shrink-0 tabular-nums text-muted-foreground">{p.startTime}</span>
                  <div className="min-w-0">
                    <span className="block truncate font-medium">{p.subject}</span>
                    {p.room && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3" aria-hidden />
                        {p.room.name}
                      </span>
                    )}
                  </div>
                </li>
              ))}
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
            <Skeleton className="h-16 w-full rounded-lg" />
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
