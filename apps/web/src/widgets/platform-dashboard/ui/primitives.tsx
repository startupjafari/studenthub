'use client'

import { useState, type ReactNode } from 'react'
import { cn } from '../../../shared/lib/utils'
import { sequentialStep, type ChartPalette } from '../model/palette'

// Части дашборда, которым chart.js не нужен: сетка теплокарты, метр, легенда,
// плитка-показатель. Всё это обычная разметка — полотно тут только мешало бы
// (нет ни осей, ни интерполяции, зато нужен доступ с клавиатуры).

/**
 * Легенда: цветной ключ + подпись + значение. Если передан onToggle — элементы
 * становятся кнопками и скрывают/показывают серию на графике (обычный способ
 * разглядеть одну линию, когда остальные её перекрывают).
 */
export function ChartLegend({
  items,
  hidden,
  onToggle,
  className,
}: {
  items: { key: string; label: string; color: string; value?: string; line?: boolean }[]
  hidden?: ReadonlySet<string>
  onToggle?: (key: string) => void
  className?: string
}) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {items.map((item) => {
        const off = hidden?.has(item.key) ?? false
        const body = (
          <>
            {/* Ключ повторяет метку: линия для линейных графиков, прямоугольник для заливок. */}
            <span
              aria-hidden
              className={cn('shrink-0 rounded-full', item.line ? 'h-0.5 w-4' : 'size-2.5')}
              style={{ backgroundColor: off ? 'currentColor' : item.color }}
            />
            {/* Текст — текстовыми токенами, а не цветом данных. */}
            <span className="text-muted-foreground">{item.label}</span>
            {item.value !== undefined && (
              <span className="font-semibold text-foreground tabular-nums">{item.value}</span>
            )}
          </>
        )
        return (
          <li key={item.key} className="flex items-center">
            {onToggle ? (
              <button
                type="button"
                onClick={() => onToggle(item.key)}
                aria-pressed={!off}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-0.5 text-xs outline-none transition-opacity hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40',
                  off && 'text-muted-foreground/50 opacity-60',
                )}
              >
                {body}
              </button>
            ) : (
              <span className="flex items-center gap-2 text-xs">{body}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Плитка-показатель: подпись, значение, необязательные дельта и спарклайн.
 *
 * Анимации: вход со сдвигом вверх (задержка по индексу — плитки появляются
 * волной, а не все разом) и счёт значения от нуля. Всё это декорация, поэтому
 * при prefers-reduced-motion вход не играет (motion-reduce:animate-none),
 * а счёт сразу показывает финальное число (см. useCountUp).
 */
export function StatTile({
  label,
  value,
  hint,
  delta,
  spark,
  /** Порядковый номер в строке — задаёт задержку входа. */
  index = 0,
}: {
  label: string
  value: string
  hint?: string
  delta?: { text: string; good: boolean } | null
  spark?: ReactNode
  index?: number
}) {
  return (
    <div
      style={{ animationDelay: `${index * 70}ms` }}
      className={cn(
        'flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4',
        'animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-both duration-500 motion-reduce:animate-none',
        // Отклик на наведение: плитка кликабельной не является, поэтому только
        // рамка и тень — без подъёма, чтобы не обещать переход.
        'transition-colors hover:border-ring/50',
      )}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      {/* Крупное число — пропорциональными цифрами; tabular только в колонках. */}
      <span className="text-2xl font-semibold leading-none">{value}</span>
      <div className="flex min-h-7 items-end justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {delta ? (
            <span className={delta.good ? 'text-success' : 'text-destructive'}>{delta.text}</span>
          ) : (
            hint
          )}
        </span>
        {spark && <span className="block h-7 w-24 shrink-0">{spark}</span>}
      </div>
    </div>
  )
}

/**
 * Метр — одна доля против предела. Незаполненный трек — светлый шаг того же тона,
 * чтобы состояние читалось по всей полосе, а не только по заливке.
 */
export function Meter({
  ratio,
  palette,
  label,
  valueText,
}: {
  ratio: number
  palette: ChartPalette
  label: string
  valueText: string
}) {
  const clamped = Math.max(0, Math.min(100, ratio))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-2xl font-semibold leading-none">{valueText}</span>
      </div>
      <div
        role="meter"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-2.5 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: palette.sequential[0] }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${clamped}%`,
            backgroundColor: sequentialStep(palette, Math.max(0.35, clamped / 100)),
          }}
        />
      </div>
    </div>
  )
}

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
    // Ширина ограничена: растянутая на всю карточку клетка получается 48×16 и
    // читается как пилюля, а не как клетка сетки. ~34px даёт почти квадрат.
    <div className="flex max-w-[52rem] flex-col gap-1" role="img" aria-label={ariaLabel}>
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
