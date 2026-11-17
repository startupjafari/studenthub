// Время в строке списка чатов — как в Telegram: по нему с первого взгляда видно, насколько
// разговор свежий, и строка не тратит место на лишние цифры.
//
//   сегодня           → 14:05
//   последние 6 дней  → Пн
//   этот год          → 12 окт.
//   раньше            → 12.10.25
//
// Будущее время (часы устройства отстают от сервера) считаем «сегодня»: «завтрашний» чат
// показывал бы дату вместо времени только что пришедшего сообщения.

const WEEK_WINDOW_DAYS = 6
const DAY_MS = 86_400_000

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function chatListTime(iso: string, locale: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS)
  if (dayDiff <= 0) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  if (dayDiff <= WEEK_WINDOW_DAYS) return d.toLocaleDateString(locale, { weekday: 'short' })
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
  }
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: '2-digit' })
}
