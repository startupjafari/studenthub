'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ArrowRight, CalendarCheck2, Clock, MapPin, MoreHorizontal, User } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../shared/ui'
import type { DayPair } from '../lib/schedule-day'
import { PAIR_BADGE, PAIR_STATE_KEY } from './pair-visuals'

interface NextPairCardProps {
  dayPair: DayPair | null
  showTeacher?: boolean
  scheduleHref?: string
  // Быстрые действия (ссылки на существующие разделы).
  quickLinks: { key: string; href: string }[]
}

// «Следующая пара» — герой-карточка экрана «Сегодня». Если пара идёт — подпись
// «Сейчас идёт»; если на сегодня пар не осталось — осмысленный EmptyState.
export function NextPairCard({
  dayPair,
  showTeacher = true,
  scheduleHref = '/schedule',
  quickLinks,
}: NextPairCardProps) {
  const t = useTranslations('Today')

  if (!dayPair) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <CalendarCheck2 className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-heading text-base font-semibold">{t('noMorePairs')}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t('noMorePairsHint')}</p>
        </CardContent>
      </Card>
    )
  }

  const { pair, state, change } = dayPair
  const start = change?.newStartTime ?? pair.startTime
  const end = change?.newEndTime ?? pair.endTime
  const room = change?.newRoom ?? pair.room
  const teacher = change?.newTeacher ?? pair.teacher
  const isNow = state === 'now'

  return (
    <Card className="relative overflow-hidden ring-1 ring-primary/15">
      <span
        className={
          isNow
            ? 'absolute inset-y-0 left-0 w-1 bg-primary'
            : 'absolute inset-y-0 left-0 w-1 bg-primary/40'
        }
        aria-hidden
      />
      <CardContent className="flex flex-col gap-4 pl-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium tracking-wide text-primary uppercase">
            {isNow ? t('nowOngoing') : t('nextPair')}
          </span>
          <Badge variant={PAIR_BADGE[state]}>{t(PAIR_STATE_KEY[state])}</Badge>
        </div>

        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-xl leading-tight font-semibold text-balance">
            {pair.subject}
          </h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <Clock className="size-4" aria-hidden />
              {start}–{end}
            </span>
            {room && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-4" aria-hidden />
                {room.name}
              </span>
            )}
            {showTeacher && teacher && (
              <span className="inline-flex items-center gap-1.5">
                <User className="size-4" aria-hidden />
                {teacher.firstName} {teacher.lastName}
              </span>
            )}
          </div>
          {change?.note && (
            <p className="text-sm text-warning-foreground dark:text-warning">{change.note}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button asChild className="gap-1.5">
            <Link href={scheduleHref}>
              {t('openSchedule')}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
          {quickLinks.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t('moreActions')}>
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {quickLinks.map((l) => (
                  <DropdownMenuItem key={l.key} asChild>
                    <Link href={l.href}>{t(l.key)}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
