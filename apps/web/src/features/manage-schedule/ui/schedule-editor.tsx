'use client'

import { useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { MapPin, User } from 'lucide-react'
import { layoutColumns, type Pair, type Placed } from '../../../entities/schedule'
import { cn } from '../../../shared/lib/utils'

const HOUR_PX = 56
// Учебный день: сетка всегда охватывает 07:00–20:00, даже если пар в крайних часах нет.
// Постоянные границы важнее компактности: колонка не «дышит» при каждой правке, и время
// на ней всегда на одном и том же месте.
const DEFAULT_START = 7 * 60
const DEFAULT_END = 20 * 60
/** Шаг привязки при перетаскивании и при клике по пустому месту. */
const SNAP_MIN = 5
/** Ниже этого сдвига в пикселях жест считается кликом, а не перетаскиванием. */
const DRAG_THRESHOLD_PX = 4
/** Минимальная длительность пары при изменении размера. */
const MIN_DURATION_MIN = 30
/** Ширина колонки времени слева, px. Должна совпадать с `3.5rem` в gridTemplateColumns. */
const TIME_COL_PX = 56

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
function snap(min: number): number {
  return Math.round(min / SNAP_MIN) * SNAP_MIN
}

type PairWithMinutes = Pair & { startMin: number; endMin: number }

// Раскладка пар одного дня по колонкам (перекрытия чётная/нечётная в одном слоте).
function layoutDay(dayPairs: Pair[]): Placed<PairWithMinutes>[] {
  return layoutColumns(
    dayPairs.map((p) => ({ ...p, startMin: toMin(p.startTime), endMin: toMin(p.endTime) })),
  )
}

/** Что сейчас тащим: саму пару целиком или её нижний край. */
interface DragState {
  pairId: string
  mode: 'move' | 'resize'
  /** Смещение точки захвата от начала пары, минуты — чтобы пара не «прыгала» под курсор. */
  grabOffsetMin: number
  day: number
  startMin: number
  endMin: number
  moved: boolean
}

/**
 * Недельная сетка расписания.
 *
 * Перенос пары — перетаскиванием: по горизонтали меняется день, по вертикали время,
 * длительность сохраняется. Раньше перенести пару можно было только через форму
 * «разовое изменение», то есть постоянное расписание правилось удалением и созданием
 * заново. Нижний край пары тянется отдельно — это изменение длительности.
 *
 * Указатели, а не HTML5 drag-and-drop: события указателя одинаково работают мышью и
 * пером, дают захват (setPointerCapture) и не требуют картинки перетаскивания.
 * Клавиатурный путь к тому же действию — форма в карточке пары; перетаскивание её
 * дублирует, а не заменяет.
 */
export function ScheduleEditor({
  pairs,
  days,
  selectedPairId,
  todayDow,
  canEditPair,
  onSlotClick,
  onPairClick,
  onPairMove,
}: {
  pairs: Pair[]
  /** Какие дни недели показывать (ISO 1–7). Выходные скрываются переключателем в шапке. */
  days: number[]
  selectedPairId: string | null
  /** Сегодняшний день недели — колонка подсвечивается. */
  todayDow: number
  canEditPair: (pair: Pair) => boolean
  onSlotClick: (dayOfWeek: number, startTime: string) => void
  onPairClick: (pair: Pair) => void
  onPairMove: (pair: Pair, next: { dayOfWeek: number; startTime: string; endTime: string }) => void
}) {
  const t = useTranslations('Schedule')
  // Ref именно на тело сетки, без шапки дней: и время, и колонка считаются от его
  // левого верхнего угла. Ref на внешний контейнер давал бы сдвиг на высоту шапки.
  const gridRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  // Призрачный слот под курсором на пустом месте: показывает, куда именно встанет пара.
  const [hover, setHover] = useState<{ day: number; startMin: number } | null>(null)

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
    const map = new Map<number, Placed<PairWithMinutes>[]>()
    for (const d of days) map.set(d, layoutDay(pairs.filter((p) => p.dayOfWeek === d)))
    return map
  }, [pairs, days])

  /** Минута под указателем — от верха тела сетки (прокрутку учитывает сам rect). */
  function pointerMin(clientY: number): number {
    const rect = gridRef.current?.getBoundingClientRect()
    if (!rect) return gridStart
    return gridStart + ((clientY - rect.top) / HOUR_PX) * 60
  }

  /** День под указателем. Колонка времени в расчёт не входит — дни начинаются после неё. */
  function pointerDay(clientX: number): number {
    const rect = gridRef.current?.getBoundingClientRect()
    if (!rect || days.length === 0) return days[0] ?? 1
    const daysWidth = rect.width - TIME_COL_PX
    const ratio = (clientX - rect.left - TIME_COL_PX) / daysWidth
    const index = Math.max(0, Math.min(days.length - 1, Math.floor(ratio * days.length)))
    return days[index] as number
  }

  function startDrag(e: React.PointerEvent, pair: PairWithMinutes, mode: DragState['mode']): void {
    if (!canEditPair(pair)) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({
      pairId: pair.id,
      mode,
      grabOffsetMin: pair.startMin - pointerMin(e.clientY),
      day: pair.dayOfWeek,
      startMin: pair.startMin,
      endMin: pair.endMin,
      moved: false,
    })
  }

  function onDragMove(e: React.PointerEvent, pair: PairWithMinutes): void {
    if (drag?.pairId !== pair.id) return
    const moved = drag.moved || Math.abs(e.movementY) + Math.abs(e.movementX) > DRAG_THRESHOLD_PX
    if (drag.mode === 'resize') {
      const end = clamp(snap(pointerMin(e.clientY)), drag.startMin + MIN_DURATION_MIN, gridEnd)
      setDrag({ ...drag, endMin: end, moved })
      return
    }
    const duration = pair.endMin - pair.startMin
    const start = clamp(
      snap(pointerMin(e.clientY) + drag.grabOffsetMin),
      gridStart,
      gridEnd - duration,
    )
    setDrag({
      ...drag,
      day: pointerDay(e.clientX),
      startMin: start,
      endMin: start + duration,
      moved,
    })
  }

  function endDrag(pair: PairWithMinutes): void {
    if (drag?.pairId !== pair.id) return
    const changed =
      drag.day !== pair.dayOfWeek || drag.startMin !== pair.startMin || drag.endMin !== pair.endMin
    // Жест без сдвига — обычный клик: открываем карточку пары.
    if (!drag.moved || !changed) onPairClick(pair)
    else {
      onPairMove(pair, {
        dayOfWeek: drag.day,
        startTime: minLabel(drag.startMin),
        endTime: minLabel(drag.endMin),
      })
    }
    setDrag(null)
  }

  return (
    <div className="min-w-[44rem]">
      {/* Заголовки дней. sticky: при прокрутке длинного дня шапка остаётся на месте. */}
      <div
        className="sticky top-0 z-20 grid border-b border-border bg-card"
        style={{ gridTemplateColumns: `${TIME_COL_PX}px repeat(${days.length}, 1fr)` }}
      >
        <div className="border-r border-border" />
        {days.map((d) => (
          <div
            key={d}
            className={cn(
              'border-r border-border px-2 py-2 text-center text-xs font-semibold last:border-r-0',
              d === todayDow ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            {t(`day${d}`)}
          </div>
        ))}
      </div>

      <div
        ref={gridRef}
        className="grid"
        style={{ gridTemplateColumns: `${TIME_COL_PX}px repeat(${days.length}, 1fr)` }}
      >
        {/* Ось времени */}
        <div className="relative border-r border-border" style={{ height: gridHeight }}>
          {hours.map((m) => (
            <div
              key={m}
              className={cn(
                'absolute right-0 pr-2 text-right text-[0.7rem] text-muted-foreground',
                // Подпись центрируется на своей линии, но первую не сдвигаем вверх:
                // половина её уходила за верхний край и обрезалась шапкой дней.
                m === gridStart ? 'top-0' : '-translate-y-1/2',
              )}
              style={m === gridStart ? undefined : { top: ((m - gridStart) / 60) * HOUR_PX }}
            >
              {minLabel(m)}
            </div>
          ))}
        </div>

        {days.map((day) => {
          const placed = byDay.get(day) ?? []
          return (
            <div
              key={day}
              onClick={(e) => {
                const min = clamp(snap(pointerMin(e.clientY)), gridStart, gridEnd - 30)
                onSlotClick(day, minLabel(min))
              }}
              onPointerMove={(e) => {
                if (drag) return
                setHover({ day, startMin: clamp(snap(pointerMin(e.clientY)), gridStart, gridEnd - 30) }) // prettier-ignore
              }}
              onPointerLeave={() => setHover(null)}
              className={cn(
                'relative cursor-copy border-r border-border last:border-r-0',
                day === todayDow && 'bg-primary/[0.04]',
              )}
              style={{ height: gridHeight }}
            >
              {hours.map((m) => (
                <div
                  key={m}
                  className="pointer-events-none absolute inset-x-0 border-t border-border/50"
                  style={{ top: ((m - gridStart) / 60) * HOUR_PX }}
                />
              ))}

              {/* Призрак будущей пары: показывает время, куда придётся клик. */}
              {hover?.day === day && !drag && (
                <div
                  className="pointer-events-none absolute inset-x-1 z-0 flex items-start rounded-lg border border-dashed border-primary/50 bg-primary/5 px-1.5 py-0.5 text-[0.7rem] font-medium text-primary"
                  style={{ top: ((hover.startMin - gridStart) / 60) * HOUR_PX, height: HOUR_PX * 1.5 }} // prettier-ignore
                >
                  {minLabel(hover.startMin)}
                </div>
              )}

              {placed.map(({ item: pair, col, cols }) => {
                const active = drag?.pairId === pair.id
                // Пока тащим — рисуем пару там, где указатель; в исходной колонке её нет.
                if (active && drag.day !== day) return null
                const startMin = active ? drag.startMin : pair.startMin
                const endMin = active ? drag.endMin : pair.endMin
                const top = ((startMin - gridStart) / 60) * HOUR_PX
                const height = Math.max(((endMin - startMin) / 60) * HOUR_PX, 24)
                const editable = canEditPair(pair)
                const compact = height < 60
                return (
                  <div
                    key={pair.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${pair.subject}, ${t(`day${pair.dayOfWeek}`)} ${pair.startTime}–${pair.endTime}`}
                    onPointerDown={(e) => startDrag(e, pair, 'move')}
                    onPointerMove={(e) => onDragMove(e, pair)}
                    onPointerUp={() => endDrag(pair)}
                    onPointerCancel={() => setDrag(null)}
                    onClick={(e) => {
                      e.stopPropagation()
                      // Пару без права правки указателем не тащат — открываем по клику.
                      if (!editable) onPairClick(pair)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onPairClick(pair)
                      }
                    }}
                    className={cn(
                      'absolute z-10 overflow-hidden rounded-lg border-l-2 border-l-primary bg-primary/10 px-1.5 py-1 text-left outline-none transition-shadow select-none hover:ring-1 hover:ring-ring/50 focus-visible:ring-2 focus-visible:ring-ring',
                      editable ? 'cursor-grab touch-none' : 'cursor-pointer',
                      active && 'z-30 cursor-grabbing shadow-lg ring-2 ring-primary',
                      pair.id === selectedPairId && !active && 'ring-2 ring-primary',
                    )}
                    style={{
                      top,
                      height,
                      left: active ? '2px' : `calc(${(col / cols) * 100}% + 2px)`,
                      width: active ? 'calc(100% - 4px)' : `calc(${(1 / cols) * 100}% - 4px)`,
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
                      {minLabel(startMin)}–{minLabel(endMin)}
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
                    {/* Ручка длительности: тянется отдельно от самой пары. */}
                    {editable && (
                      <span
                        role="presentation"
                        onPointerDown={(e) => startDrag(e, pair, 'resize')}
                        onPointerMove={(e) => onDragMove(e, pair)}
                        onPointerUp={() => endDrag(pair)}
                        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize touch-none"
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}
