'use client'

import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  Tooltip,
  type ChartOptions,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'

// Регистрируем только нужные части chart.js (tree-shaking). Импортируется через next/dynamic ssr:false.
ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

// Slate-400 читается на светлой и тёмной теме; синий — брендовый primary.
const AXIS = '#94a3b8'
const BAR = '#3b82f6'
const GRID = 'rgba(148,163,184,0.15)'

const OPTIONS: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: AXIS }, grid: { display: false } },
    y: { ticks: { color: AXIS, precision: 0 }, grid: { color: GRID }, beginAtZero: true },
  },
}

export default function StatsBarChart({ labels, values }: { labels: string[]; values: number[] }) {
  return (
    <div className="h-64">
      <Bar
        options={OPTIONS}
        data={{
          labels,
          datasets: [{ data: values, backgroundColor: BAR, borderRadius: 6, maxBarThickness: 56 }],
        }}
      />
    </div>
  )
}
