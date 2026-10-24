import { PLATFORM_TIME_ZONE } from '../../modules/platform/platform.constants'

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

// Смещение пояса относительно UTC в этот момент, мс (Алматы: +5 ч).
function offsetMs(date: Date, timezone: string | null | undefined): number {
  const label = localDateTimeLabel(date, timezone)
  const [day, time] = label.split(' ') as [string, string]
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const [h, mi] = time.split(':').map(Number) as [number, number]
  const asUtc = Date.UTC(y, m - 1, d, h, mi)
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000
}

/**
 * Срок в письме («26 октября 2026 г. в 14:30 GMT+5») — в поясе вуза и с подписью пояса.
 * `Intl` без `timeZone` печатал время процесса API, а он живёт в UTC: ссылка «до 14:30»
 * на деле истекала в 19:30 по Алматы. Без пояса вуза (заявка, платформенные роли) —
 * пояс платформы; подпись GMT+N всё равно стоит, и время не прочитать по-другому.
 */
export function deadlineLabel(
  date: Date,
  locale: string,
  timezone: string | null | undefined,
): string {
  const format = (timeZone: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(date)
  try {
    return format(timezone || PLATFORM_TIME_ZONE)
  } catch {
    // Неизвестное имя пояса в настройках вуза не должно ронять письмо.
    return format(PLATFORM_TIME_ZONE)
  }
}
