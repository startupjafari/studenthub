'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { CalendarDays, ChevronRight, ClipboardList, MapPin } from 'lucide-react'
import {
  Card,
  CardContent,
  DatePicker,
  EmptyState,
  Label,
  PageHeader,
  Skeleton,
} from '../../../shared/ui'
import { isoWeekParity, nowInTz } from '../../../shared/lib'
import { scheduleKeys, fetchSchedule } from '../../../entities/schedule'
import { AttendanceRoster } from './attendance-roster'

// «Посещаемость» преподавателя: выбор даты → занятия этого дня → ростер отметок.
export function TeacherAttendanceView() {
  const t = useTranslations('Attendance')
  const schedule = useQuery({ queryKey: scheduleKeys.view({}), queryFn: () => fetchSchedule({}) })
  const [date, setDate] = useState(() => nowInTz(null).date)
  const [openPairId, setOpenPairId] = useState<string | null>(null)

  const dayPairs = useMemo(() => {
    const pairs = schedule.data?.pairs ?? []
    const d = new Date(`${date}T00:00:00`)
    const dow = ((d.getDay() + 6) % 7) + 1
    const parity = isoWeekParity(d)
    return pairs
      .filter((p) => p.dayOfWeek === dow && (p.weekType === 'BOTH' || p.weekType === parity))
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
  }, [schedule.data?.pairs, date])

  if (openPairId) {
    return <AttendanceRoster pairId={openPairId} date={date} onBack={() => setOpenPairId(null)} />
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title={t('title')}
        actions={
          <div className="w-44">
            <Label className="sr-only">{t('date')}</Label>
            <DatePicker value={date} onChange={(v) => setDate(v)} />
          </div>
        }
      />

      {schedule.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : dayPairs.length === 0 ? (
        <EmptyState icon={<CalendarDays />} title={t('noPairs')} description={t('noPairsHint')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {dayPairs.map((p) => (
            <li key={p.id}>
              <Card className="transition-colors hover:bg-muted/40">
                <CardContent className="p-0">
                  <button
                    type="button"
                    onClick={() => setOpenPairId(p.id)}
                    className="flex w-full items-center gap-3 p-3.5 text-left outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
                  >
                    <span className="w-14 shrink-0 text-sm tabular-nums text-muted-foreground">
                      {p.startTime}
                    </span>
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <ClipboardList className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.subject}</span>
                      {p.room && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="size-3" aria-hidden />
                          {p.room.name}
                        </span>
                      )}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
