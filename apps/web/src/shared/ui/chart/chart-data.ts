// Преобразования данных для графиков. Recharts принимает не «подписи + серии», а
// массив строк-объектов (одна строка = одна корзина по X), поэтому раскладка живёт
// здесь: это чистые функции, их можно проверить тестом без монтирования полотна.

export interface ChartSeries {
  key: string
  label: string
  color: string
  values: number[]
  /** Скрыта переключателем в легенде. */
  hidden?: boolean
}

/** Строка данных recharts: подпись корзины плюс значение каждой серии по её ключу. */
export type ChartRow = { label: string } & Record<string, number | string>

/**
 * Ряды recharts из подписей и серий. Скрытые серии остаются в строках: их прячет
 * `hide` на самой линии, и когда читатель включает серию обратно, данные уже есть —
 * пересборки массива и повторной анимации входа не происходит.
 */
export function toRows(labels: string[], series: readonly ChartSeries[]): ChartRow[] {
  return labels.map((label, i) => {
    const row: ChartRow = { label }
    for (const s of series) row[s.key] = s.values[i] ?? 0
    return row
  })
}

/**
 * Верхняя видимая серия стека — только у неё скругляется верх колонки. Считается по
 * видимости, а не по позиции в массиве: если выключить последнюю серию, скругление
 * должно перейти к той, что теперь сверху.
 */
export function topVisibleKey(series: readonly ChartSeries[]): string | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const s = series[i]
    if (s && !s.hidden) return s.key
  }
  return null
}

/**
 * Прозрачность серии, когда читатель ведёт курсор по легенде: наведённая остаётся
 * в полную краску, остальные уходят в фон. Это способ разглядеть одну линию, не
 * выключая остальные кликом.
 */
export function seriesOpacity(key: string, focus: string | null): number {
  if (!focus || focus === key) return 1
  return 0.22
}

/** Ширина оси подписей у горизонтальных полос: длинные названия вузов не должны обрезаться. */
export function categoryAxisWidth(labels: readonly string[]): number {
  const longest = labels.reduce((max, l) => Math.max(max, l.length), 0)
  // ~6.2px на символ при 11px шрифте оси; края держим, чтобы полосы не съедало.
  return Math.min(220, Math.max(64, Math.round(longest * 6.2) + 8))
}
