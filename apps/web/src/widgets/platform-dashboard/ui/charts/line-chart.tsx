'use client'

import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type Chart,
  type ChartOptions,
  type Plugin,
} from 'chart.js'
import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import type { ChartPalette } from '../../model/palette'

// Регистрируем только нужные части chart.js (tree-shaking, FRONTEND_RULES §4/§11).
// Файл грузится через next/dynamic ssr:false.
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Tooltip,
  Filler,
)

export interface LineSeries {
  key: string
  label: string
  color: string
  values: number[]
  /** Скрыта переключателем в легенде. */
  hidden?: boolean
}

// Вертикальный визир: читатель наводится на дату, а не на 2px линию.
// В chart.js его нет из коробки, поэтому рисуем сами — плагин на десяток строк
// дешевле новой зависимости.
const crosshair: Plugin<'line'> = {
  id: 'crosshair',
  afterDatasetsDraw(chart: Chart<'line'>) {
    const active = chart.getActiveElements()
    const first = active[0]
    if (!first) return
    const x = first.element.x
    const { top, bottom } = chart.chartArea
    const { ctx } = chart
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, bottom)
    ctx.lineWidth = 1
    ctx.strokeStyle = (chart.options as { crosshairColor?: string }).crosshairColor ?? '#898781'
    ctx.stroke()
    ctx.restore()
  },
}

export default function LineChart({
  labels,
  series,
  palette,
  /** Заливка под линией — только когда серия одна (иначе washи перекрываются). */
  area = false,
  height = 260,
  ariaLabel,
}: {
  labels: string[]
  series: LineSeries[]
  palette: ChartPalette
  area?: boolean
  height?: number
  ariaLabel: string
}) {
  // options и data мемоизируем: без этого каждый рендер родителя отдаёт chart.js
  // новые объекты, и он пересобирает шкалы вместо обновления точек.
  const options: ChartOptions<'line'> & { crosshairColor?: string } = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      // Короткая анимация только на входе; при наведении — ноль, иначе каждое
      // движение курсора запускает перерисовку с интерполяцией.
      animation: { duration: 180 },
      transitions: { active: { animation: { duration: 0 } } },
      // resizeDelay здесь НЕ ставим. Он откладывает обработку изменения размера, и
      // если за это время полотно ушло из DOM (Fast Refresh, уход со страницы),
      // chart.js вызывает getComputedStyle(parentNode) уже для отсоединённого узла:
      // parentNode === null → «Cannot read properties of null (reading 'ownerDocument')».
      // Один тултип на все серии: указателю не нужно попадать в линию.
      interaction: { mode: 'index', intersect: false },
      crosshairColor: palette.axis,
      plugins: {
        // Легенда своя, в HTML: она несёт ещё и значение (правило рельефа
        // для слотов ниже 3:1 на светлой поверхности).
        legend: { display: false },
        tooltip: {
          backgroundColor: palette.surface,
          borderColor: palette.grid,
          borderWidth: 1,
          // Значение ведёт, подпись следует.
          titleColor: palette.axis,
          bodyColor: palette.ink,
          padding: 10,
          displayColors: true,
          boxWidth: 10,
          boxHeight: 2,
          callbacks: {
            label: (item) => ` ${item.formattedValue} · ${item.dataset.label ?? ''}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: palette.axis, maxRotation: 0, autoSkipPadding: 16 },
          // Вертикальные линии сетки не нужны: визир уже отмечает X.
          grid: { display: false },
          border: { display: false },
        },
        y: {
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
      datasets: series.map((s) => ({
        label: s.label,
        data: s.values,
        hidden: s.hidden ?? false,
        borderColor: s.color,
        backgroundColor: area ? `${s.color}1a` : s.color,
        fill: area,
        borderWidth: 2,
        borderJoinStyle: 'round' as const,
        borderCapStyle: 'round' as const,
        // Точки только под курсором: маркер на каждом дне превращает линию в шум.
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBorderWidth: 2,
        pointHoverBorderColor: palette.surface,
        pointHoverBackgroundColor: s.color,
        tension: 0,
      })),
    }),
    [labels, series, area, palette],
  )

  return (
    <div style={{ height }} role="img" aria-label={ariaLabel}>
      <Line options={options} plugins={[crosshair]} data={data} />
    </div>
  )
}
