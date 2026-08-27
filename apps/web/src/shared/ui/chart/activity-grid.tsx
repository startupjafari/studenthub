'use client'

import { useState } from 'react'
import { sequentialStep, type ChartPalette } from './palette'
import { cn } from '../../lib/utils'

// Теплокарта 7×24 — обычная разметка, а не полотно графика: осей и интерполяции тут
// нет, зато нужен доступ с клавиатуры. Поднята из виджета дашборда платформы в
// систему (DESIGN_SYSTEM §17): её же просит загрузка аудиторий на дашборде вуза.

const HOUR_TICKS = [0, 6, 12, 18]

/**
 * Теплокарта 7×24: сравнение величины в сетке. У сетки нет визира по X, поэтому
 * цель наведения — сама ячейка, и подсказка своя, а не нативный title: title
 * появляется через секунду и не показывается по фокусу с клавиатуры.
 */
export function ActivityGrid({
  cells,
  max,
  palette,
  dayLabels,
  cellTitle,
  ariaLabel,
}: {
  cells: number[][]
  max: number
  palette: ChartPalette
  dayLabels: string[]
  cellTitle: (day: string, hour: number, value: number) => string
  ariaLabel: string
}) {
  const [active, setActive] = useState<{ day: number; hour: number } | null>(null)
  const activeText =
    active && cells[active.day]
      ? cellTitle(dayLabels[active.day] ?? '', active.hour, cells[active.day]?.[active.hour] ?? 0)
      : null

  return (
    // Сетка занимает всю ширину карточки. Клетки остаются квадратными (`aspect-square`
    // на ячейке), поэтому вместе с шириной растёт и высота — это осознанно: обрезанная
    // по ширине сетка оставляла половину карточки пустой.
    <div className="flex w-full flex-col gap-1" role="img" aria-label={ariaLabel}>
      {/* Читаемое значение держим в одной строке над сеткой: 168 ячеек своих
          всплывающих подсказок дали бы дрожание и перерисовку на каждый пиксель. */}
      <p className="min-h-5 text-xs font-medium text-foreground" aria-live="polite">
        {activeText ?? ''}
      </p>
      {cells.map((row, day) => (
        <div key={day} className="flex items-center gap-2">
          <span className="w-7 shrink-0 text-right text-[0.6875rem] text-muted-foreground">
            {dayLabels[day]}
          </span>
          {/* 2px зазора между ячейками даёт сама сетка (gap), а не обводка. */}
          <div className="grid min-w-0 flex-1 grid-cols-[repeat(24,minmax(0,1fr))] gap-1">
            {row.map((value, hour) => {
              const on = active?.day === day && active?.hour === hour
              return (
                <span
                  key={hour}
                  tabIndex={0}
                  role="button"
                  aria-label={cellTitle(dayLabels[day] ?? '', hour, value)}
                  onPointerEnter={() => setActive({ day, hour })}
                  onFocus={() => setActive({ day, hour })}
                  onPointerLeave={() => setActive(null)}
                  onBlur={() => setActive(null)}
                  className={cn(
                    'aspect-square rounded-[3px] outline-none transition-[box-shadow]',
                    // Наведённая ячейка «поднимается» кольцом цветом поверхности,
                    // чтобы читатель видел отклик и не терял её из вида.
                    on && 'ring-2 ring-foreground/40',
                  )}
                  style={{
                    backgroundColor:
                      value === 0 ? palette.grid : sequentialStep(palette, max ? value / max : 0),
                  }}
                />
              )
            })}
          </div>
        </div>
      ))}
      {/* Ось часов повторяет структуру строки (спейсер + тот же 24-колоночный grid),
          иначе подписи уезжают от своих колонок. */}
      <div className="flex items-center gap-2">
        <span className="w-7 shrink-0" aria-hidden />
        <div className="grid min-w-0 flex-1 grid-cols-[repeat(24,minmax(0,1fr))] gap-1">
          {Array.from({ length: 24 }, (_, hour) => (
            <span
              key={hour}
              className="text-center text-[0.625rem] tabular-nums text-muted-foreground"
              aria-hidden
            >
              {HOUR_TICKS.includes(hour) ? hour : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
