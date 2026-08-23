'use client'

import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  Tooltip,
  type ChartOptions,
} from 'chart.js'
import { useMemo } from 'react'
import { Bar } from 'react-chartjs-2'
import type { ChartPalette } from '../../model/palette'

ChartJS.register(CategoryScale, LinearScale, BarElement, BarController, Tooltip)

export interface StackSeries {
  key: string
  label: string
  color: string
  values: number[]
  /** Скрыта переключателем в легенде. */
  hidden?: boolean
}

// Стековые колонки для «часть-целое по корзинам»: статусы инвайтов по неделям.
// Цвета сегментов — статусная палитра (это состояния, не серии), поэтому в легенде
// они обязательно с подписью, а не одним цветом.
export default function StackedBarChart({
  labels,
  series,
  palette,
  height = 260,
  ariaLabel,
}: {
  labels: string[]
  series: StackSeries[]
  palette: ChartPalette
  height?: number
  ariaLabel: string
}) {
  const options: ChartOptions<'bar'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      // Короткая анимация на входе; при наведении ноль (в chart.js v4 это
      // transitions.active, а не hover.animationDuration).
      animation: { duration: 180 },
      transitions: { active: { animation: { duration: 0 } } },
      // resizeDelay здесь НЕ ставим. Он откладывает обработку изменения размера, и
      // если за это время полотно ушло из DOM (Fast Refresh, уход со страницы),
      // chart.js вызывает getComputedStyle(parentNode) уже для отсоединённого узла:
      // parentNode === null → «Cannot read properties of null (reading 'ownerDocument')».
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: palette.surface,
          borderColor: palette.grid,
          borderWidth: 1,
          titleColor: palette.axis,
          bodyColor: palette.ink,
          padding: 10,
          boxWidth: 10,
          boxHeight: 10,
          callbacks: {
            label: (item) => ` ${item.formattedValue} · ${item.dataset.label ?? ''}`,
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: palette.axis, maxRotation: 0, autoSkipPadding: 16 },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { color: palette.axis, precision: 0, maxTicksLimit: 5 },
          grid: { color: palette.grid },
          border: { display: false },
        },
      },
    }),
    [palette],
  )

  const data = useMemo(
    () => ({
      labels,
      datasets: series.map((s, i) => ({
        label: s.label,
        data: s.values,
        hidden: s.hidden ?? false,
        backgroundColor: s.color,
        // 2px разрыва цветом поверхности между сегментами стека: в chart.js
        // это делается бордюром одной стороны — краска та же, что у фона,
        // то есть визуально это именно зазор, а не обводка метки.
        borderColor: palette.surface,
        borderWidth: { top: 2, right: 0, bottom: 0, left: 0 },
        // Скругление — только у верхнего сегмента стека, у базовой линии прямой угол.
        borderRadius: i === series.length - 1 ? { topLeft: 4, topRight: 4 } : 0,
        borderSkipped: false,
        maxBarThickness: 24,
      })),
    }),
    [labels, series, palette],
  )

  return (
    <div style={{ height }} role="img" aria-label={ariaLabel}>
      <Bar options={options} data={data} />
    </div>
  )
}
