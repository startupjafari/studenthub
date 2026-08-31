'use client'

import { useTranslations } from 'next-intl'
import { CalendarDays, MapPin, User } from 'lucide-react'
import { Badge, EmptyState, SectionPanel } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import type { DayPair } from '../lib/schedule-day'
import { PAIR_ACCENT, PAIR_BADGE, PAIR_STATE_KEY } from './pair-visuals'

interface TodayTimelineProps {
  dayPairs: DayPair[]
  showTeacher?: boolean
}

// «Расписание сегодня» — компактный вертикальный timeline. Поддерживает обычную,
// отменённую, перенесённую пару, замену преподавателя и смену аудитории.
export function TodayTimeline({ dayPairs, showTeacher = true }: TodayTimelineProps) {
  const t = useTranslations('Today')

  return (
    <SectionPanel title={t('todaySchedule')} subtitle={t('todayScheduleHint')}>
      <>
        {dayPairs.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="size-6" aria-hidden />}
            title={t('noPairsToday')}
            className="border-0 p-6"
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {dayPairs.map((dp) => {
              const start = dp.change?.newStartTime ?? dp.pair.startTime
              const end = dp.change?.newEndTime ?? dp.pair.endTime
              const room = dp.change?.newRoom ?? dp.pair.room
              const teacher = dp.change?.newTeacher ?? dp.pair.teacher
              const dim = dp.state === 'past' || dp.state === 'cancelled'
              return (
                <li
                  key={dp.pair.id}
                  className={cn(
                    'flex gap-3 rounded-lg border border-l-4 border-border/60 p-2.5 transition-colors',
                    PAIR_ACCENT[dp.state],
                  )}
                >
                  <div className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
                    <div
                      className={cn('font-medium text-foreground', dim && 'text-muted-foreground')}
                    >
                      {start}
                    </div>
                    <div>{end}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={cn(
                          'truncate text-sm font-medium',
                          dp.state === 'cancelled' && 'text-muted-foreground line-through',
                        )}
                      >
                        {dp.pair.subject}
                      </span>
                      {dp.state !== 'normal' && (
                        <Badge variant={PAIR_BADGE[dp.state]} className="shrink-0">
                          {t(PAIR_STATE_KEY[dp.state])}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {room && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" aria-hidden />
                          {room.name}
                        </span>
                      )}
                      {showTeacher && teacher && (
                        <span className="inline-flex items-center gap-1">
                          <User className="size-3" aria-hidden />
                          {teacher.firstName} {teacher.lastName}
                        </span>
                      )}
                    </div>
                    {dp.change?.note && (
                      <p className="mt-1 text-xs text-warning-foreground dark:text-warning">
                        {dp.change.note}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </>
    </SectionPanel>
  )
}
