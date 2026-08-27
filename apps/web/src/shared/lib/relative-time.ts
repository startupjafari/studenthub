// Компактное относительное время («5 нед. назад», «2 ч. назад»).
//
// Своя реализация на Intl.RelativeTimeFormat, а не `useFormatter().relativeTime`
// из next-intl: тому нужна явная опорная точка `now`, иначе он берёт текущее время
// запасным вариантом и предупреждает об этом в консоли (ENVIRONMENT_FALLBACK) —
// на сервере и на клиенте отсчёт получился бы от разных моментов.
//
// Здесь отсчёт всегда от Date.now() и только на клиенте, поэтому расхождения нет.
const REL_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
]

export function relativeTime(iso: string, locale: string): string {
  const diffSec = (new Date(iso).getTime() - Date.now()) / 1000
  const abs = Math.abs(diffSec)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  for (const [unit, secs] of REL_UNITS) {
    if (abs >= secs) return rtf.format(Math.round(diffSec / secs), unit)
  }
  // Меньше минуты — «только что», а не «0 минут назад»: numeric: 'auto' даёт это сам.
  return rtf.format(Math.round(diffSec / 60), 'minute')
}
