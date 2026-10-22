import { localDateString, localDateTimeLabel, localDayRange } from '../../common/time/local-label'

// Даты библиотеки (Фаза 20) — по часам вуза. Срок выдачи — день, «до конца которого» книгу
// надо вернуть: хранится последней миллисекундой этого дня, показывается датой «ГГГГ-ММ-ДД».

/** Сегодня «ГГГГ-ММ-ДД» по часам вуза. */
export function todayIn(timezone: string, now = new Date()): string {
  return localDateString(now, timezone)
}

/** Дата + дни, календарно (без часовых поясов: «ГГГГ-ММ-ДД» → «ГГГГ-ММ-ДД»). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Сколько календарных дней от `from` до `to` (обе «ГГГГ-ММ-ДД»). */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number) as [number, number, number]
  const [y2, m2, d2] = to.split('-').map(Number) as [number, number, number]
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

/** Последний момент дня `date` по часам вуза — так хранится срок выдачи. */
export function endOfDay(date: string, timezone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  // Момент внутри нужных местных суток: полдень UTC этой даты, сдвинутый на смещение пояса —
  // иначе в поясах дальше ±12 ч полдень UTC попадал бы в соседние сутки.
  const probe = Date.UTC(y, m - 1, d, 12)
  const label = localDateTimeLabel(new Date(probe), timezone)
  const [day, time] = label.split(' ') as [string, string]
  const [ly, lm, ld] = day.split('-').map(Number) as [number, number, number]
  const [lh, lmi] = time.split(':').map(Number) as [number, number]
  const offset = Date.UTC(ly, lm - 1, ld, lh, lmi) - probe
  const { end } = localDayRange(new Date(probe - offset), timezone)
  return new Date(end.getTime() - 1)
}

/** «ДД.ММ.ГГГГ» — дата в тексте уведомления: одинаково читается на всех трёх языках. */
export function formatDay(date: string): string {
  const [y, m, d] = date.split('-')
  return `${d}.${m}.${y}`
}
