// Палитра графиков. Цвет данных уходит в SVG-атрибут (`fill`, `stroke`), где токен
// темы недоступен, — поэтому значения заданы здесь и переключаются по активной теме.
//
// Категориальные слоты и последовательная шкала прогнаны валидатором палитры
// против РЕАЛЬНЫХ поверхностей карточек StudentHub (--card: #ffffff светлая,
// #151922 тёмная), а не против дефолтных:
//   светлая: полоса светлоты PASS, порог насыщенности PASS, CVD ΔE 9.2 (deutan) PASS,
//            нормальное зрение ΔE 27.6 PASS, контраст — WARN по aqua (2.82:1)
//   тёмная:  все шесть проверок PASS
// Из-за WARN действует правило рельефа: у графиков с несколькими сериями легенда
// показывает значение цифрой, то есть идентичность и величина не держатся на цвете.
//
// Порядок слотов — механизм CVD-безопасности, а не украшение: менять его нельзя
// без повторного прогона валидатора.

export interface ChartPalette {
  /** Категориальные слоты 1–3. Больше трёх серий на этом дашборде нет. */
  series: readonly [string, string, string]
  /** Последовательная шкала (один тон, светлое → тёмное) для величины. */
  sequential: readonly string[]
  /** Статусы состояний: только с иконкой и подписью, никогда цветом одним. */
  status: { good: string; warning: string; serious: string; critical: string }
  surface: string
  grid: string
  axis: string
  /** Основной цвет текста — для значения в тултипе (текст не носит цвет данных). */
  ink: string
  /** Приглушённый тон для контекста — фон спарклайна, незаполненный трек метра. */
  muted: string
}

const LIGHT: ChartPalette = {
  series: ['#2a78d6', '#eb6834', '#1baf7a'],
  // Ординальная шкала: на светлой поверхности не светлее шага 250 (2.06:1).
  sequential: ['#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab'],
  status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' },
  surface: '#ffffff',
  grid: '#e1e0d9',
  axis: '#898781',
  ink: '#0b0b0b',
  muted: '#c3c2b7',
}

const DARK: ChartPalette = {
  series: ['#3987e5', '#d95926', '#199e70'],
  // На тёмной поверхности не темнее шага 600 (2.15:1) — иначе шаг тонет в фоне.
  sequential: ['#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec'],
  status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' },
  surface: '#151922',
  grid: '#2c2c2a',
  axis: '#898781',
  ink: '#ffffff',
  muted: '#52514e',
}

export function chartPalette(dark: boolean): ChartPalette {
  return dark ? DARK : LIGHT
}

/** Шаг последовательной шкалы по доле величины (0…1). */
export function sequentialStep(palette: ChartPalette, ratio: number): string {
  if (ratio <= 0) return palette.muted
  const steps = palette.sequential
  const index = Math.min(steps.length - 1, Math.floor(ratio * steps.length))
  return steps[index] ?? steps[steps.length - 1] ?? palette.series[0]
}
