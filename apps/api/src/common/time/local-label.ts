/**
 * Метка «2026-10-02 14:30» в часовом поясе вуза — для текста уведомлений о записи.
 *
 * `toISOString()` давал UTC: приём в 09:00 по Алматы студент видел как «04:00». Шведская
 * локаль выбрана ради формата: она печатает дату ISO-порядком, и метка выглядит как прежде.
 * Без пояса (вуз не указал) — UTC, как раньше.
 */
export function localDateTimeLabel(date: Date, timezone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date)
  } catch {
    // Неизвестное имя пояса в настройках вуза не должно ронять уведомление.
    return date.toISOString().slice(0, 16).replace('T', ' ')
  }
}

/** Дата «YYYY-MM-DD» в часовом поясе вуза (без пояса — UTC). */
export function localDateString(date: Date, timezone: string | null | undefined): string {
  return localDateTimeLabel(date, timezone).slice(0, 10)
}

/**
 * Границы суток по часам вуза как моменты времени: [начало, начало следующих суток).
 *
 * `setHours(0, 0, 0, 0)` брал полночь сервера (UTC): фильтр «срок сегодня» с полуночи до
 * пяти утра по Алматы показывал вчерашние сроки. Смещение берётся на начало суток — в
 * поясах с переходом на летнее время граница остаётся верной и в день перехода.
 */
export function localDayRange(
  date: Date,
  timezone: string | null | undefined,
): { start: Date; end: Date } {
  const [y, m, d] = localDateString(date, timezone).split('-').map(Number) as [
    number,
    number,
    number,
  ]
  const midnightUtc = Date.UTC(y, m - 1, d)
  const start = new Date(midnightUtc - offsetMs(new Date(midnightUtc), timezone))
  const nextUtc = Date.UTC(y, m - 1, d + 1)
  const end = new Date(nextUtc - offsetMs(new Date(nextUtc), timezone))
  return { start, end }
}

/**
 * Полночь календарной даты по часам пояса как момент времени (без пояса — UTC). Нужна
 * границам периодов «с понедельника», «с 1 сентября»: полночь UTC в Алматы — это 05:00, и
 * первые часы периода уходили в предыдущий.
 */
export function localMidnight(
  year: number,
  monthIndex: number,
  day: number,
  timezone: string | null | undefined,
): Date {
  const utc = Date.UTC(year, monthIndex, day)
  return new Date(utc - offsetMs(new Date(utc), timezone))
}

// Смещение пояса относительно UTC в этот момент, мс (Алматы: +5 ч).
function offsetMs(date: Date, timezone: string | null | undefined): number {
  const label = localDateTimeLabel(date, timezone)
  const [day, time] = label.split(' ') as [string, string]
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const [h, mi] = time.split(':').map(Number) as [number, number]
  const asUtc = Date.UTC(y, m - 1, d, h, mi)
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000
}
