'use client'

import { useQuery } from '@tanstack/react-query'
import { nowInTz } from '../../../shared/lib'
import { fetchSchedule, scheduleKeys } from '../../../entities/schedule'

// Время записи в деканат — по часам вуза, а не браузера (FRONTEND_RULES §9, как пары): студент
// с телефоном в другом поясе выбирал «10:00», а деканат видел другое время приёма. Пояс вуза
// отдаёт расписание; тот же запрос держат «Сегодня» и «Мои задачи», он обычно уже в кэше.

/** Пояс вуза зрителя (null, пока не загрузился, — тогда время браузера, как раньше). */
export function useUniversityTimezone(): string | null {
  const schedule = useQuery({ queryKey: scheduleKeys.view({}), queryFn: () => fetchSchedule({}) })
  return schedule.data?.timezone ?? null
}

/** «Сейчас» в поясе вуза в формате поля даты-времени "YYYY-MM-DDTHH:mm". */
export function nowWallInput(timezone: string | null): string {
  const now = nowInTz(timezone)
  return `${now.date}T${now.time}`
}

/** Смещение пояса от UTC в момент `at`, мс (с точностью до секунды). */
function offsetMs(at: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  )
  return wall - Math.floor(at / 1000) * 1000
}

/**
 * Настенное время вуза "YYYY-MM-DDTHH:mm" → ISO-момент. Без пояса (или с неизвестным
 * поясом) — время браузера. Смещение уточняется вторым проходом: на переходе летнего
 * времени смещение «угаданного» момента и итогового различаются.
 */
export function wallInputToIso(value: string, timezone: string | null): string {
  if (!timezone) return new Date(value).toISOString()
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!m) return new Date(value).toISOString()
  const guess = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!)
  try {
    const first = guess - offsetMs(guess, timezone)
    const second = guess - offsetMs(first, timezone)
    return new Date(second).toISOString()
  } catch {
    return new Date(value).toISOString()
  }
}
