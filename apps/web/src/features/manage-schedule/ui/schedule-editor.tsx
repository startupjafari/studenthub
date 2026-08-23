'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { MapPin, Plus, User } from 'lucide-react'
import { layoutColumns, type Pair, type Placed } from '../../../entities/schedule'
import { cn } from '../../../shared/lib/utils'

const HOUR_PX = 56
const DEFAULT_START = 8 * 60
const DEFAULT_END = 20 * 60

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}
function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function minLabel(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`
}

// Раскладка пар одного дня по колонкам (перекрытия чётная/нечётная в одном слоте).
function layoutDay(dayPairs: Pair[]): Placed<Pair & { startMin: number; endMin: number }>[] {
  return layoutColumns(
    dayPairs.map((p) => ({ ...p, startMin: toMin(p.startTime), endMin: toMin(p.endTime) })),
  )
}

export function ScheduleEditor({
  pairs,
  selectedPairId,
  onSlotClick,
  onPairClick,
}: {
  pairs: Pair[]
  selectedPairId: string | null
  onSlotClick: (dayOfWeek: number, startTime: string) => void
  onPairClick: (pair: Pair) => void
}) {
  const t = useTranslations('Schedule')

  const [gridStart, gridEnd] = useMemo(() => {
    let min = DEFAULT_START
    let max = DEFAULT_END
    for (const p of pairs) {
      min = Math.min(min, toMin(p.startTime))
      max = Math.max(max, toMin(p.endTime))
    }
    return [Math.floor(min / 60) * 60, Math.ceil(max / 60) * 60]
  }, [pairs])

  const hours = useMemo(() => {
    const out: number[] = []
    for (let m = gridStart; m <= gridEnd; m += 60) out.push(m)
    return out
  }, [gridStart, gridEnd])
  const gridHeight = ((gridEnd - gridStart) / 60) * HOUR_PX

  const byDay = useMemo(() => {
    const map = new Map<number, ReturnType<typeof layoutDay>>()
    for (let d = 1; d <= 7; d++) {
      map.set(d, layoutDay(pairs.filter((p) => p.dayOfWeek === d)))
    }
    return map
  }, [pairs])

  function handleColumnClick(e: React.MouseEvent<HTMLDivElement>, day: number): void {
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    let min = gridStart + (y / HOUR_PX) * 60
    min = Math.round(min / 15) * 15 // округление к 15 минутам
    min = Math.max(gridStart, Math.min(min, gridEnd - 30))
    onSlotClick(day, minLabel(min))
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <div className="min-w-[46rem]">
        {/* Заголовки дней */}
        <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] border-b border-border bg-muted/30">
          <div className="border-r border-border" />
          {Array.from({ length: 7 }, (_, i) => (
            <div
              key={i}
              className="border-r border-border px-2 py-2 text-center text-xs font-semibold text-muted-foreground last:border-r-0"
            >
              {t(`day${i + 1}`)}
            </div>
          ))}
        </div>

        {/* Сетка */}
        <div className="grid grid-cols-[3.5rem_repeat(7,1fr)]">
          {/* Ось времени */}
          <div className="relative border-r border-border" style={{ height: gridHeight }}>
            {hours.map((m) => (
              <div
                key={m}
                className="absolute right-0 -translate-y-1/2 pr-2 text-right text-[0.7rem] text-muted-foreground"
                style={{ top: ((m - gridStart) / 60) * HOUR_PX }}
              >
                {minLabel(m)}
              </div>
            ))}
          </div>

          {/* Дни */}
          {Array.from({ length: 7 }, (_, i) => {
            const day = i + 1
            const placed = byDay.get(day) ?? []
            return (
              <div
                key={day}
                onClick={(e) => handleColumnClick(e, day)}
                className="group/col relative cursor-copy border-r border-border last:border-r-0 hover:bg-primary/[0.03]"
                style={{ height: gridHeight }}
              >
                {hours.map((m) => (
                  <div
                    key={m}
                    className="pointer-events-none absolute inset-x-0 border-t border-border/50"
                    style={{ top: ((m - gridStart) / 60) * HOUR_PX }}
                  />
                ))}
                {/* Подсказка «+» при наведении на пустую колонку */}
                <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-2 opacity-0 transition-opacity group-hover/col:opacity-100">
                  <Plus className="size-4 text-primary/50" aria-hidden />
                </div>
                {placed.map(({ item: pair, col, cols }) => {
                  const s = toMin(pair.startTime)
                  const e = toMin(pair.endTime)
                  const top = ((s - gridStart) / 60) * HOUR_PX
                  const height = Math.max(((e - s) / 60) * HOUR_PX, 24)
                  const selected = pair.id === selectedPairId
                  const compact = height < 48
                  return (
                    <button
                      key={pair.id}
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation()
                        onPairClick(pair)
                      }}
                      className={cn(
                        'absolute z-10 overflow-hidden rounded-lg border-l-2 border-l-primary bg-primary/10 px-1.5 py-1 text-left transition-shadow hover:ring-1 hover:ring-ring/50',
                        selected && 'ring-2 ring-primary',
                      )}
                      style={{
                        top,
                        height,
                        left: `calc(${(col / cols) * 100}% + 2px)`,
                        width: `calc(${(1 / cols) * 100}% - 4px)`,
                      }}
                    >
                      <div className="flex items-center gap-1">
                        <span className="truncate text-xs font-semibold">{pair.subject}</span>
                        {pair.weekType !== 'BOTH' && (
                          <span className="shrink-0 rounded bg-primary/20 px-1 text-[0.6rem] font-medium">
                            {t(`parity${pair.weekType}`)}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[0.7rem] opacity-80">
                        {pair.startTime}–{pair.endTime}
                      </div>
                      {!compact && pair.room && (
                        <div className="flex items-center gap-1 truncate text-[0.7rem] opacity-80">
                          <MapPin className="size-3 shrink-0" aria-hidden />
                          {pair.room.name}
                        </div>
                      )}
                      {!compact && pair.teacher && (
                        <div className="flex items-center gap-1 truncate text-[0.7rem] opacity-80">
                          <User className="size-3 shrink-0" aria-hidden />
                          {pair.teacher.lastName} {pair.teacher.firstName}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
