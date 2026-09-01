'use client'

import type { ReactNode } from 'react'
import { cn } from '../../../shared/lib/utils'
import { sequentialStep, type ChartPalette } from '../../../shared/ui/chart'
// ActivityGrid и ChartLegend переехали в систему (shared/ui/chart) — здесь только
// реэкспорт, чтобы не переписывать импорты дашборда платформы.
export { ActivityGrid, ChartLegend } from '../../../shared/ui/chart'

// Части дашборда, которым полотно графика не нужно: метр и плитка-показатель.
// Это обычная разметка — полотно тут только мешало бы (нет ни осей, ни интерполяции,
// зато нужен доступ с клавиатуры). Теплокарта и легенда переехали в shared/ui/chart.

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
