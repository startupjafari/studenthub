// Публичный вход набора графиков.
//
// Здесь только то, что НЕ тянет recharts: палитра, тема, раскладка данных. Сами
// полотна (`line-chart`, `bar-chart`, `stacked-bar-chart`) сюда не реэкспортируются
// намеренно — их подключают напрямую через `next/dynamic` (FRONTEND_RULES §4, §11),
// иначе recharts приехал бы в основной бандл всем, кто импортирует `shared/ui`.
export { chartPalette, sequentialStep, type ChartPalette } from './palette'
export { ActivityGrid } from './activity-grid'
export { ChartLegend } from './chart-legend'
export { useChartTheme } from './use-chart-theme'
export { useReducedMotion } from './use-reduced-motion'
export {
  categoryAxisWidth,
  seriesOpacity,
  toRows,
  topVisibleKey,
  type ChartRow,
  type ChartSeries,
} from './chart-data'
