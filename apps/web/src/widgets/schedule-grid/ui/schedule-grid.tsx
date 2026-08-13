'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import type { ScheduleQueryInput } from '@studenthub/shared-schemas'
import {
  fetchSchedule,
  fetchScheduleChanges,
  scheduleKeys,
  type ScheduleChange,
  type WeekType,
} from '../../../entities/schedule'
import { useRealtimeEvent } from '../../../shared/realtime'
import { EmptyState, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { PairDetailSheet } from './pair-detail-sheet'

interface ScheduleGridProps {
  // Доп. фильтры сверх ролевого scope (группа/преподаватель/аудитория) — для декана/админа/преподавателя.
  filters?: ScheduleQueryInput
}

type ParityMode = 'AUTO' | 'ODD' | 'EVEN'
const PARITY_MODES: ParityMode[] = ['AUTO', 'ODD', 'EVEN']

const HOUR_PX = 56 // высота одного часа в сетке
const DEFAULT_START_MIN = 8 * 60 // 08:00
const DEFAULT_END_MIN = 20 * 60 // 20:00

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}
function minToLabel(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`
}
// Понедельник недели, содержащей дату d.
function mondayOf(d: Date): Date {
  const m = new Date(d)
  m.setHours(0, 0, 0, 0)
  m.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return m
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(d.getDate() + n)
  return r
}
// Номер ISO-недели — для авто-определения чётности.
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000))
}

export function ScheduleGrid({ filters = {} }: ScheduleGridProps) {
  const t = useTranslations('Schedule')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()

  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()))
  const [parityMode, setParityMode] = useState<ParityMode>('AUTO')

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )
  const autoParity: WeekType = isoWeek(weekStart) % 2 === 1 ? 'ODD' : 'EVEN'
  const effectiveParity: WeekType = parityMode === 'AUTO' ? autoParity : parityMode

  // Пары — без фильтра по чётности (получаем все, фильтруем по неделе на клиенте).
  const schedule = useQuery({
    queryKey: scheduleKeys.view(filters),
    queryFn: () => fetchSchedule(filters),
  })

  const changesQuery = {
    from: fmtDate(weekDates[0]!),
    to: fmtDate(weekDates[6]!),
    ...(filters.groupId ? { groupId: filters.groupId } : {}),
    ...(filters.teacherId ? { teacherId: filters.teacherId } : {}),
  }
  const changes = useQuery({
    queryKey: scheduleKeys.changes(changesQuery),
    queryFn: () => fetchScheduleChanges(changesQuery),
  })

  useRealtimeEvent<{ groupId: string }>('schedule:changed', () => {
    void qc.invalidateQueries({ queryKey: scheduleKeys.all })
    toast.info(t('changedToast'))
  })

  // pairId+дата → изменение (для наложения на конкретный день недели).
  const changeMap = useMemo(() => {
    const map = new Map<string, ScheduleChange>()
    for (const c of changes.data ?? []) map.set(`${c.pairId}|${c.date.slice(0, 10)}`, c)
    return map
  }, [changes.data])

  // Видимые на этой неделе пары (по чётности), сгруппированные по дню (1..7).
  const pairs = useMemo(
    () =>
      (schedule.data?.pairs ?? []).filter(
        (p) => p.weekType === 'BOTH' || p.weekType === effectiveParity,
      ),
    [schedule.data, effectiveParity],
  )

  // Границы сетки по времени — от самой ранней до самой поздней пары (с запасом), иначе 08–20.
  const [gridStart, gridEnd] = useMemo(() => {
    let min = DEFAULT_START_MIN
    let max = DEFAULT_END_MIN
    for (const p of pairs) {
      min = Math.min(min, toMin(p.startTime))
      max = Math.max(max, toMin(p.endTime))
    }
    for (const c of changes.data ?? []) {
      if (c.newStartTime) min = Math.min(min, toMin(c.newStartTime))
      if (c.newEndTime) max = Math.max(max, toMin(c.newEndTime))
    }
    return [Math.floor(min / 60) * 60, Math.ceil(max / 60) * 60]
  }, [pairs, changes.data])

  const hours = useMemo(() => {
    const out: number[] = []
    for (let m = gridStart; m <= gridEnd; m += 60) out.push(m)
    return out
  }, [gridStart, gridEnd])
  const gridHeight = ((gridEnd - gridStart) / 60) * HOUR_PX

  const today = new Date()
  const todayIdx = weekDates.findIndex((d) => d.toDateString() === today.toDateString())
  const nowMin = today.getHours() * 60 + today.getMinutes()

  const weekLabel = `${weekDates[0]!.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} – ${weekDates[6]!.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}`

  return (
    <div className="flex flex-col gap-3">
      {/* Панель: навигация по неделям + чётность + таймзона */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t('prevWeek')}
            onClick={() => setWeekStart((d) => addDays(d, -7))}
            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(mondayOf(new Date()))}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            {t('today')}
          </button>
          <button
            type="button"
            aria-label={t('nextWeek')}
            onClick={() => setWeekStart((d) => addDays(d, 7))}
            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
          <span className="ml-2 text-sm font-semibold">{weekLabel}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-xl border border-border p-1">
            {PARITY_MODES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setParityMode(p)}
                title={
                  p === 'AUTO'
                    ? t('parityAutoHint', { parity: t(`parity${autoParity}`) })
                    : undefined
                }
                className={cn(
                  'cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  parityMode === p
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {p === 'AUTO' ? t('parityAuto') : t(`parity${p}`)}
              </button>
            ))}
          </div>
          {schedule.data?.timezone && (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {t('timezone', { tz: schedule.data.timezone })}
            </span>
          )}
        </div>
      </div>

      {schedule.isLoading ? (
        <Skeleton className="h-[28rem] w-full" />
      ) : schedule.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : pairs.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="size-6" aria-hidden />}
          title={t('emptyTitle')}
          description={t('emptyHint')}
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <div className="min-w-[52rem]">
            {/* Заголовки дней */}
            <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] border-b border-border bg-muted/30">
              <div className="border-r border-border" />
              {weekDates.map((d, i) => {
                const isToday = i === todayIdx
                return (
                  <div
                    key={i}
                    className={cn(
                      'border-r border-border px-2 py-2 text-center last:border-r-0',
                      isToday && 'bg-primary/10',
                    )}
                  >
                    <div className="text-xs text-muted-foreground">{t(`day${i + 1}`)}</div>
                    <div className={cn('text-sm font-semibold', isToday && 'text-primary')}>
                      {d.getDate()}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Сетка часов + колонки дней */}
            <div className="grid grid-cols-[3.5rem_repeat(7,1fr)]">
              {/* Ось времени */}
              <div className="relative border-r border-border" style={{ height: gridHeight }}>
                {hours.map((m) => (
                  <div
                    key={m}
                    className="absolute -translate-y-1/2 pr-2 text-right text-[0.7rem] text-muted-foreground"
                    style={{ top: ((m - gridStart) / 60) * HOUR_PX, right: 0 }}
                  >
                    {minToLabel(m)}
                  </div>
                ))}
              </div>

              {/* Колонки дней */}
              {weekDates.map((date, dayIdx) => {
                const dow = dayIdx + 1
                const dateStr = fmtDate(date)
                const dayPairs = pairs.filter((p) => p.dayOfWeek === dow)
                return (
                  <div
                    key={dayIdx}
                    className={cn(
                      'relative border-r border-border last:border-r-0',
                      dayIdx === todayIdx && 'bg-primary/[0.04]',
                    )}
                    style={{ height: gridHeight }}
                  >
                    {/* Часовые линии */}
                    {hours.map((m) => (
                      <div
                        key={m}
                        className="absolute inset-x-0 border-t border-border/50"
                        style={{ top: ((m - gridStart) / 60) * HOUR_PX }}
                      />
                    ))}
                    {/* Линия «сейчас» */}
                    {dayIdx === todayIdx && nowMin >= gridStart && nowMin <= gridEnd && (
                      <div
                        className="absolute inset-x-0 z-20 border-t-2 border-red-500"
                        style={{ top: ((nowMin - gridStart) / 60) * HOUR_PX }}
                      >
                        <span className="absolute -left-1 -top-1 size-2 rounded-full bg-red-500" />
                      </div>
                    )}
                    {/* Занятия — клик открывает интерактивную деталь пары (PR-3b). */}
                    {dayPairs.map((p) => (
                      <PairDetailSheet
                        key={p.id}
                        pair={p}
                        change={changeMap.get(`${p.id}|${dateStr}`)}
                        gridStart={gridStart}
                        date={dateStr}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
