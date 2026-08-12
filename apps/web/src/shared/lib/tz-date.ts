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
  const d = new Date()
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

// Чётность ISO-недели (для выбора пар ODD/EVEN) — как в schedule-grid.
export function isoWeekParity(d = new Date()): 'ODD' | 'EVEN' {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 - 3) / 7)
  return week % 2 === 1 ? 'ODD' : 'EVEN'
}
