// Хелперы «настенного» времени в таймзоне вуза. Расписание/задания/события хранят
// время в таймзоне университета (docs/PROJECT.md §3.1), поэтому «сейчас» и «сегодня»
// вычисляем в этой же таймзоне через Intl, а не в таймзоне браузера.

export interface NowInTz {
  // ISO день недели 1=Пн…7=Вс.
  dayOfWeek: number
  // Настенное время "HH:mm".
  time: string
  // Дата "YYYY-MM-DD" в этой таймзоне.
  date: string
}

export function nowInTz(timezone: string | null): NowInTz {
  return wallClockInTz(new Date(), timezone)
}

// Настенные дата и время произвольного момента в таймзоне вуза: срок задания или начало
// события «в какой день» — по календарю вуза, а не по UTC-префиксу ISO-строки.
export function wallClockInTz(d: Date, timezone: string | null): NowInTz {
  if (!timezone) return localNow(d)
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d)
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
    const wk: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
    const hour = get('hour') === '24' ? '00' : get('hour')
    return {
      dayOfWeek: wk[get('weekday')] ?? localNow(d).dayOfWeek,
      time: `${hour}:${get('minute')}`,
      date: `${get('year')}-${get('month')}-${get('day')}`,
    }
  } catch {
    return localNow(d)
  }
}

function localNow(d: Date): NowInTz {
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    dayOfWeek: ((d.getDay() + 6) % 7) + 1,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
  }
}

// Номер ISO-недели (ISO 8601: недели с понедельника, первая — та, где первый четверг года)
// по календарной дате d (её локальные год/месяц/день; время суток не важно).
export function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  // Четверг той же недели: его год — это год ISO-недели (29.12.2025 — уже 1-я неделя 2026-го).
  date.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7))
  // Четверг N-й недели — всегда (7N−6)…7N-й день своего года, поэтому номер — целое деление
  // от 1 января. Прежняя формула отсчитывала от 4 января без поправки на его день недели и в
  // годах, где 4 января не четверг, давала неделю на единицу меньше — чётность переворачивалась.
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1)
  return 1 + Math.floor((date.getTime() - yearStart) / (7 * 86_400_000))
}

// Чётность ISO-недели (для выбора пар ODD/EVEN). Единственная реализация на весь веб:
// сетка расписания, «Сегодня», главная, курсы, календарь и посещаемость обязаны показывать
// одну и ту же неделю.
export function isoWeekParity(d = new Date()): 'ODD' | 'EVEN' {
  return isoWeek(d) % 2 === 1 ? 'ODD' : 'EVEN'
}
