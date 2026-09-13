// Публичный вход набора графиков.
//
// Здесь только то, что НЕ тянет recharts: палитра, тема, раскладка данных. Сами
// полотна (`line-chart`, `bar-chart`, `stacked-bar-chart`) сюда не реэкспортируются
// намеренно — их подключают напрямую через `next/dynamic` (FRONTEND_RULES §4, §11),
// иначе recharts приехал бы в основной бандл всем, кто импортирует `shared/ui`.
export { chartPalette, sequentialStep, type ChartPalette } from './palette'
export { ActivityGrid } from './activity-grid'
export { ChartLegend } from './chart-legend'
export {
  DAY_GROUPS,
  HOUR_LABELS,
  WEEKDAYS,
  averageDay,
  weekdayAverages,
  type DayHourGrid,
} from './day-profile'
export { useChartTheme } from './use-chart-theme'
export { useSeriesToggle } from './use-series-toggle'
export { useReducedMotion } from './use-reduced-motion'
export {
  categoryAxisWidth,
  seriesOpacity,
  toRows,
  topVisibleKey,
  type ChartRow,
  type ChartSeries,
} from './chart-data'
