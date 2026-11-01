'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarClock, CalendarDays, CalendarX2, MapPin, Video } from 'lucide-react'
import {
  buildDayPairs,
  fetchSchedule,
  fetchScheduleChanges,
  scheduleKeys,
  type ScheduleChangeType,
} from '../../../entities/schedule'
import { eventKeys, fetchEvents } from '../../../entities/event'
import { FriendsPanel } from '../../../widgets/friends-panel'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
} from '../../../shared/ui'
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
  const tCommon = useTranslations('Common')
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

  // Сбой загрузки — своё состояние с «Повторить» (FRONTEND_RULES §9). Раньше пустой массив
  // по умолчанию превращал любую ошибку в «Сегодня пар нет» / «Нет событий», и студент
  // уходил, уверенный, что пар нет.
  const loadFailed = (refetch: () => unknown) => (
    <EmptyState
      title={tCommon('error')}
      action={
        <Button size="sm" variant="outline" onClick={() => void refetch()}>
          {tCommon('retry')}
        </Button>
      }
      className="border-0 p-6"
    />
  )

  // Пустое состояние — одной строкой: большая карточка «ничего нет» в узкой колонке
  // занимала полэкрана и сообщала ровно одну фразу.
  const quietEmpty = (icon: React.ReactNode, text: string) => (
    <p className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
      {icon}
      {text}
    </p>
  )

  return (
    <>
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="size-4 text-primary" aria-hidden />
            {t('scheduleToday')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {schedQ.isLoading ? (
            <Skeleton fill className="min-h-16 rounded-lg" />
          ) : schedQ.isError && !schedQ.data ? (
            loadFailed(schedQ.refetch)
          ) : todayPairs.length === 0 ? (
            quietEmpty(<CalendarX2 className="size-4 shrink-0" aria-hidden />, t('noPairsToday'))
          ) : (
            <ul className="flex flex-col gap-1">
              {todayPairs.map(({ pair, change, state }) => {
                const cancelled = state === 'cancelled'
                const room = change?.newRoom ?? pair.room
                const changeKey = change ? CHANGE_STATE_KEY[change.type] : null
                return (
                  <li
                    key={pair.id}
                    // Идущая пара — акцентом слева, прошедшие приглушены: колонку читают
                    // ради ответа «что сейчас и что дальше», а не всего дня целиком.
                    aria-current={state === 'now' ? 'time' : undefined}
                    className={cn(
                      'flex items-start gap-3 rounded-lg px-2 py-1.5 text-sm',
                      state === 'now' && 'bg-primary/10 ring-1 ring-primary/25',
                      state === 'past' && 'opacity-60',
                    )}
                  >
                    <span className="w-11 shrink-0 pt-px text-xs font-medium tabular-nums text-muted-foreground">
                      {change?.newStartTime ?? pair.startTime}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      {/* Длинное название переносится, а не обрезается: «Основы
                          программирования и алгори…» не отвечает, какая это пара. */}
                      <span
                        className={cn(
                          'leading-snug font-medium break-words',
                          cancelled && 'text-muted-foreground line-through',
                        )}
                      >
                        {pair.subject}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        {room && !cancelled && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="size-3 shrink-0" aria-hidden />
                            {room.name}
                          </span>
                        )}
                        {/* Изменение — мягкой плашкой: заметно, но не тревожно. */}
                        {changeKey && (
                          <span
                            className={cn(
                              'rounded-full px-1.5 py-px text-[11px] font-medium',
                              cancelled
                                ? 'bg-destructive/10 text-destructive'
                                : 'bg-warning/10 text-warning',
                            )}
                          >
                            {tToday(changeKey)}
                          </span>
                        )}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="size-4 text-primary" aria-hidden />
            {t('upcomingEvents')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {eventsQ.isLoading ? (
            <Skeleton fill className="min-h-16 rounded-lg" />
          ) : eventsQ.isError && !eventsQ.data ? (
            loadFailed(eventsQ.refetch)
          ) : events.length === 0 ? (
            quietEmpty(
              <CalendarClock className="size-4 shrink-0" aria-hidden />,
              t('noUpcomingEvents'),
            )
          ) : (
            <ul className="flex flex-col gap-1">
              {events.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/events/${e.id}`}
                    className="flex flex-col gap-0.5 rounded-lg px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                  >
                    <span className="line-clamp-2 leading-snug font-medium break-words">
                      {e.title}
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
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
                  </Link>
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
