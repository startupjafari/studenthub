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
