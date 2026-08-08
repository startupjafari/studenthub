// Чистые хелперы календаря (без внешних зависимостей) — общие для DatePicker/DateRangePicker.
// Значение дат — строка "YYYY-MM-DD" (локальная дата, без времени/таймзоны).

export function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

export function parseYmd(v: string | undefined | null): Date | null {
  if (!v) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// 42 ячейки видимого месяца (6 недель), первый столбец — понедельник.
export function monthCells(year: number, month: number): Date[] {
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7 // Пн = 0
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, i - firstWeekday + 1))
}
