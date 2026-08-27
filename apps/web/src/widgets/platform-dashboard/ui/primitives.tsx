'use client'

import type { ReactNode } from 'react'
import { cn } from '../../../shared/lib/utils'
import { sequentialStep, type ChartPalette } from '../../../shared/ui/chart'
// ActivityGrid переехал в систему (shared/ui/chart) — здесь только реэкспорт,
// чтобы не переписывать импорты дашборда платформы.
export { ActivityGrid } from '../../../shared/ui/chart'

// Части дашборда, которым полотно графика не нужно: метр, легенда, плитка-показатель.
// Всё это обычная разметка — полотно тут только мешало бы (нет ни осей, ни интерполяции,
// зато нужен доступ с клавиатуры). Теплокарта отсюда переехала в shared/ui/chart.

/**
 * Легенда: цветной ключ + подпись + значение. Если передан onToggle — элементы
 * становятся кнопками и скрывают/показывают серию на графике (обычный способ
 * разглядеть одну линию, когда остальные её перекрывают).
 *
 * `onFocusChange` — наведение (и фокус с клавиатуры) на элемент легенды: график
 * гасит остальные серии, пока курсор здесь. Это разглядывание без выключения, то
 * есть без потери контекста: линия остаётся на своём месте среди остальных.
 */
export function ChartLegend({
  items,
  hidden,
  onToggle,
  onFocusChange,
  className,
}: {
  items: { key: string; label: string; color: string; value?: string; line?: boolean }[]
  hidden?: ReadonlySet<string>
  onToggle?: (key: string) => void
  onFocusChange?: (key: string | null) => void
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
                onPointerEnter={() => onFocusChange?.(item.key)}
                onPointerLeave={() => onFocusChange?.(null)}
                onFocus={() => onFocusChange?.(item.key)}
                onBlur={() => onFocusChange?.(null)}
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
        'flex flex-col gap-1.5 rounded-xl bg-card p-4 ring-1 ring-foreground/10',
        'animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-both duration-500 motion-reduce:animate-none',
        // Отклик на наведение: плитка кликабельной не является, поэтому только
        // кольцо — без подъёма, чтобы не обещать переход.
        'transition-[box-shadow] hover:ring-ring/50',
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
