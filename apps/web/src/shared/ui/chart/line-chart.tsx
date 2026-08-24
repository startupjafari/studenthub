'use client'

import { useId, useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { seriesOpacity, toRows, type ChartSeries } from './chart-data'
import type { ChartPalette } from './palette'
import { useReducedMotion } from './use-reduced-motion'
import { ANIMATION_MS, CHART_MARGIN, ChartTooltip, axisProps } from './chart-kit'

export type { ChartSeries as LineSeries }

/**
 * Временной ряд. Рисуется областями, а не линиями, но заливка включается только
 * когда на графике осталась одна видимая серия: у нескольких washи перекрываются и
 * врут о величине. Поэтому клик по легенде не просто гасит линию — он превращает
 * график в «одну серию с заливкой», и это самый быстрый способ разглядеть форму.
 *
 * `syncId` связывает все временные панели дашборда: курсор над одной датой
 * показывает эту же дату на остальных — рост, активность и поток жалоб читаются
 * как один срез, а не как три независимые картинки.
 */
export default function LineChart({
  labels,
  series,
  palette,
  height = 260,
  ariaLabel,
  syncId,
  focus = null,
}: {
  labels: string[]
  series: ChartSeries[]
  palette: ChartPalette
  height?: number
  ariaLabel: string
  /** Общий идентификатор синхронизации курсора между графиками одного периода. */
  syncId?: string
  /** Серия под курсором в легенде: остальные уходят в фон. */
  focus?: string | null
}) {
  const reduced = useReducedMotion()
  // Идентификатор заливок уникален на экземпляр графика. Брать его из syncId нельзя:
  // он общий у всех панелей периода, и серии с одинаковым ключом делили бы градиент.
  const gradientId = useId()
  const rows = useMemo(() => toRows(labels, series), [labels, series])
  const visible = series.filter((s) => !s.hidden)
  const filled = visible.length === 1

  return (
    // role="group" вместо role="img": полотно recharts — это SVG с клавиатурной
    // навигацией (accessibilityLayer), стрелки водят курсор по корзинам. Объявить
    // его картинкой значило бы спрятать эту навигацию от скринридера.
    <div style={{ height }} role="group" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={CHART_MARGIN} syncId={syncId} title={ariaLabel}>
          <defs>
            {series.map((s) => (
              <linearGradient
                key={s.key}
                id={`fill-${gradientId}-${s.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          {/* Вертикальных линий сетки нет: X отмечает визир под курсором. */}
          <CartesianGrid stroke={palette.grid} vertical={false} />
          <XAxis dataKey="label" {...axisProps(palette)} minTickGap={16} />
          <YAxis {...axisProps(palette)} width={36} allowDecimals={false} tickCount={5} />
          <Tooltip
            // Визир: читатель наводится на дату, а не на 2px линию.
            cursor={{ stroke: palette.axis, strokeWidth: 1 }}
            content={(props) => <ChartTooltip {...props} />}
            isAnimationActive={false}
          />
          {series.map((s) => (
            <Area
              key={s.key}
              type="linear"
              dataKey={s.key}
              name={s.label}
              hide={s.hidden}
              stroke={s.color}
              strokeWidth={focus === s.key ? 2.5 : 2}
              strokeOpacity={seriesOpacity(s.key, focus)}
              fill={`url(#fill-${gradientId}-${s.key})`}
              fillOpacity={filled ? 1 : 0}
              // Точки только под курсором: маркер на каждом дне превращает линию в шум.
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: palette.surface, fill: s.color }}
              isAnimationActive={!reduced}
              animationDuration={ANIMATION_MS}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
