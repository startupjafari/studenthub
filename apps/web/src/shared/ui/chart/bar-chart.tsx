'use client'

import { useMemo } from 'react'
import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { categoryAxisWidth } from './chart-data'
import { sequentialStep, type ChartPalette } from './palette'
import { useReducedMotion } from './use-reduced-motion'
import { ANIMATION_MS, ChartTooltip, axisProps } from './chart-kit'

// Горизонтальный бар для задачи «сравнить величину»: одна серия, последовательная
// шкала (один тон, больше — темнее). Категориальные цвета здесь врали бы — вузы и
// действия не «разные сущности со своей идентичностью», а одна величина.
//
// Горизонтальная ориентация выбрана из-за длинных подписей (названия вузов, имена
// действий в аудите): в колонках они встают под углом и перестают читаться.
export default function BarChart({
  labels,
  values,
  palette,
  height = 260,
  ariaLabel,
  seriesName,
}: {
  labels: string[]
  values: number[]
  palette: ChartPalette
  height?: number
  ariaLabel: string
  /**
   * Подпись ряда в подсказке. Без неё Recharts берёт имя поля данных, и в тултипе
   * появлялось техническое «value». Ряд здесь один, поэтому по умолчанию подпись
   * не выводится вовсе — категория уже стоит заголовком подсказки.
   */
  seriesName?: string
}) {
  const reduced = useReducedMotion()
  const max = Math.max(...values, 1)
  const rows = useMemo(
    () => labels.map((label, i) => ({ label, value: values[i] ?? 0 })),
    [labels, values],
  )

  return (
    <div style={{ height }} role="group" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <RBarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
          title={ariaLabel}
        >
          {/* Сетка только по величине: на дорожках категорий линии не нужны. */}
          <CartesianGrid stroke={palette.grid} horizontal={false} />
          <XAxis type="number" {...axisProps(palette)} allowDecimals={false} tickCount={5} />
          <YAxis
            type="category"
            dataKey="label"
            {...axisProps(palette)}
            width={categoryAxisWidth(labels)}
            interval={0}
          />
          <Tooltip
            // Подсветка всей дорожки: цель наведения — строка, а не сама полоса,
            // иначе в тонкую полосу приходится попадать курсором.
            cursor={{ fill: palette.axis, fillOpacity: 0.12 }}
            // Одна серия: имя ей не нужно — подпись дорожки уже стоит в заголовке
            // подсказки, а второй раз она читается как «Группы · Группы».
            content={(props) => <ChartTooltip {...props} marker={false} />}
            isAnimationActive={false}
          />
          <Bar
            dataKey="value"
            name={seriesName}
            // Скругление только на конце данных, у базовой линии — прямой угол.
            radius={[0, 4, 4, 0]}
            // Полосу не даём распухать на весь слот: остаток дорожки — воздух.
            maxBarSize={24}
            // Полоса под курсором получает обводку цветом поверхности — отклик виден
            // и на тёмном шаге шкалы, где изменение краски почти не читается.
            activeBar={{ stroke: palette.ink, strokeWidth: 1, strokeOpacity: 0.35 }}
            isAnimationActive={!reduced}
            animationDuration={ANIMATION_MS}
          >
            {rows.map((row) => (
              <Cell key={row.label} fill={sequentialStep(palette, row.value / max)} />
            ))}
          </Bar>
        </RBarChart>
      </ResponsiveContainer>
    </div>
  )
}
