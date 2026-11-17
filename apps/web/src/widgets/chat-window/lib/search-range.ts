/**
 * Период поиска по переписке: границы — дни "YYYY-MM-DD" в поясе смотрящего (как их отдаёт
 * DateRangePicker), сервер ждёт моменты ISO. Чистые функции — проверяются тестом без браузера.
 */

export interface SearchDayRange {
  /** Первый день периода, '' — без нижней границы. */
  from: string
  /** Последний день периода, '' — без верхней границы. */
  to: string
}

export const EMPTY_DAY_RANGE: SearchDayRange = { from: '', to: '' }

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

/** Задан ли период хоть одной границей. */
export function hasDayRange(range: SearchDayRange): boolean {
  return YMD_RE.test(range.from) || YMD_RE.test(range.to)
}

/**
 * Границы для `GET /chats/search?from=&to=`: начало первого дня и конец последнего в поясе
 * смотрящего — «сообщения за 12 мая» значат его 12 мая, а не UTC. Перепутанные границы
 * меняются местами: сервер на «конец раньше начала» ответил бы ошибкой.
 */
export function dayRangeToIso(range: SearchDayRange): { from?: string; to?: string } {
  let from = YMD_RE.test(range.from) ? range.from : ''
  let to = YMD_RE.test(range.to) ? range.to : ''
  if (from && to && from > to) [from, to] = [to, from]
  return {
    ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}),
    ...(to ? { to: new Date(`${to}T23:59:59.999`).toISOString() } : {}),
  }
}

/**
 * Подпись метки периода в шапке поиска: «12 мая — 3 июн.», один день — одной датой; без
 * одной из границ — «с 12 мая» / «по 3 июн.» (подписи «с»/«по» даёт вызывающий: это i18n).
 */
export function formatDayRange(
  range: SearchDayRange,
  locale: string,
): { kind: 'both' | 'from' | 'to' | 'none'; text: string } {
  const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
  const fmtYear = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  const thisYear = new Date().getFullYear()
  const show = (ymd: string): string => {
    const d = new Date(`${ymd}T00:00:00`)
    return (d.getFullYear() === thisYear ? fmt : fmtYear).format(d)
  }
  const from = YMD_RE.test(range.from) ? range.from : ''
  const to = YMD_RE.test(range.to) ? range.to : ''
  if (from && to) {
    const [lo, hi] = from <= to ? [from, to] : [to, from]
    return { kind: 'both', text: lo === hi ? show(lo) : `${show(lo)} — ${show(hi)}` }
  }
  if (from) return { kind: 'from', text: show(from) }
  if (to) return { kind: 'to', text: show(to) }
  return { kind: 'none', text: '' }
}
