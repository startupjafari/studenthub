'use client'

import { useMemo } from 'react'
import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { seriesOpacity, toRows, topVisibleKey, type ChartSeries } from './chart-data'
import type { ChartPalette } from './palette'
import { useReducedMotion } from './use-reduced-motion'
import { ANIMATION_MS, CHART_MARGIN, ChartTooltip, axisProps } from './chart-kit'

export type { ChartSeries as StackSeries }

const STACK_ID = 'status'

// Стековые колонки для «часть-целое по корзинам»: статусы инвайтов по неделям.
// Цвета сегментов — статусная палитра (это состояния, не серии), поэтому в легенде
// они обязательно с подписью, а не одним цветом.
export default function StackedBarChart({
  labels,
  series,
  palette,
  height = 260,
  ariaLabel,
  totalLabel,
  focus = null,
}: {
  labels: string[]
  series: ChartSeries[]
  palette: ChartPalette
  height?: number
  ariaLabel: string
  /** Подпись строки «всего» в подсказке: у стека сумма — и есть целое. */
  totalLabel?: string
  focus?: string | null
}) {
  const reduced = useReducedMotion()
  const rows = useMemo(() => toRows(labels, series), [labels, series])
  // Скругление верха — у той серии, что сейчас сверху стека, а не у последней в массиве.
  const top = topVisibleKey(series)

  return (
    <div style={{ height }} role="group" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <RBarChart data={rows} margin={CHART_MARGIN} title={ariaLabel}>
          <CartesianGrid stroke={palette.grid} vertical={false} />
          <XAxis dataKey="label" {...axisProps(palette)} minTickGap={16} />
          <YAxis {...axisProps(palette)} width={36} allowDecimals={false} tickCount={5} />
          <Tooltip
            cursor={{ fill: palette.axis, fillOpacity: 0.12 }}
            content={(props) => <ChartTooltip {...props} total totalLabel={totalLabel} />}
            isAnimationActive={false}
          />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId={STACK_ID}
              hide={s.hidden}
              fill={s.color}
              fillOpacity={seriesOpacity(s.key, focus)}
              // Волосяная обводка цветом поверхности разделяет сегменты стека: краска
              // та же, что у фона карточки, то есть визуально это зазор, а не рамка.
              stroke={palette.surface}
              strokeWidth={1}
              radius={s.key === top ? [4, 4, 0, 0] : 0}
              maxBarSize={24}
              isAnimationActive={!reduced}
              animationDuration={ANIMATION_MS}
            />
          ))}
        </RBarChart>
      </ResponsiveContainer>
    </div>
  )
}
