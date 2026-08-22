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
import { sequentialStep, type ChartPalette } from '../../model/palette'

ChartJS.register(CategoryScale, LinearScale, BarElement, BarController, Tooltip)

// Горизонтальный бар для задачи «сравнить величину»: одна серия, последовательная
// шкала (один тон, больше — темнее). Категориальные цвета здесь были бы врут —
// вузы и действия не «разные сущности со своей идентичностью», а одна величина.
//
// Горизонтальная ориентация выбрана из-за длинных подписей (названия вузов,
// имена действий в аудите): в колонках они встают под углом и перестают читаться.
export default function BarChart({
  labels,
  values,
  palette,
  height = 260,
  ariaLabel,
}: {
  labels: string[]
  values: number[]
  palette: ChartPalette
  height?: number
  ariaLabel: string
}) {
  const max = Math.max(...values, 1)
  const options: ChartOptions<'bar'> = useMemo(
    () => ({
      indexAxis: 'y' as const,
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
      // На барах цель наведения — сама метка, визир не нужен.
      interaction: { mode: 'nearest', intersect: true },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: palette.surface,
          borderColor: palette.grid,
          borderWidth: 1,
          titleColor: palette.axis,
          bodyColor: palette.ink,
          padding: 10,
          displayColors: false,
          callbacks: { label: (item) => ` ${item.formattedValue}` },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { color: palette.axis, precision: 0, maxTicksLimit: 5 },
          grid: { color: palette.grid },
          border: { display: false },
        },
        y: {
          ticks: { color: palette.axis, autoSkip: false },
          grid: { display: false },
          border: { display: false },
        },
      },
    }),
    [palette],
  )

  const data = useMemo(
    () => ({
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: values.map((v) => sequentialStep(palette, v / max)),
          // Скругление только на конце данных, у базовой линии — прямой угол.
          borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 4, bottomRight: 4 },
          borderSkipped: false,
          // Полосу не даём распухать на весь слот: остаток дорожки — воздух.
          maxBarThickness: 24,
        },
      ],
    }),
    [labels, values, palette, max],
  )

  return (
    <div style={{ height }} role="img" aria-label={ariaLabel}>
      <Bar options={options} data={data} />
    </div>
  )
}
