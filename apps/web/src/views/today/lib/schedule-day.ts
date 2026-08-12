import type { Pair, ScheduleChange } from '../../../entities/schedule'
import { nowInTz, isoWeekParity, type NowInTz } from '../../../shared/lib'

// Доменные хелперы «дня» для расписания. Базовые tz-функции (nowInTz/isoWeekParity)
// живут в shared/lib и переиспользуются экранами «Сегодня»/«Задачи»/«Календарь».
export { nowInTz, isoWeekParity }
export type { NowInTz }

export type PairState = 'normal' | 'cancelled' | 'moved' | 'room' | 'substituted' | 'past' | 'now'

export interface DayPair {
  pair: Pair
  state: PairState
  change: ScheduleChange | null
  // Идёт прямо сейчас.
  isCurrent: boolean
}

const CHANGE_STATE: Record<ScheduleChange['type'], PairState> = {
  CANCELLED: 'cancelled',
  MOVED: 'moved',
  ROOM_CHANGED: 'room',
  SUBSTITUTED: 'substituted',
}

// Пары на сегодня с наложенными изменениями и признаком «сейчас/прошло».
export function buildDayPairs(
  pairs: Pair[],
  changes: ScheduleChange[],
  now: NowInTz,
  parity: 'ODD' | 'EVEN',
): DayPair[] {
  const todayChanges = new Map<string, ScheduleChange>()
  for (const c of changes) {
    if (c.date.slice(0, 10) === now.date) todayChanges.set(c.pairId, c)
  }

  return pairs
    .filter(
      (p) => p.dayOfWeek === now.dayOfWeek && (p.weekType === 'BOTH' || p.weekType === parity),
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((pair) => {
      const change = todayChanges.get(pair.id) ?? null
      const start = change?.newStartTime ?? pair.startTime
      const end = change?.newEndTime ?? pair.endTime
      let state: PairState = change ? CHANGE_STATE[change.type] : 'normal'
      const isCurrent = state !== 'cancelled' && now.time >= start && now.time < end
      if (state === 'normal') {
        if (isCurrent) state = 'now'
        else if (now.time >= end) state = 'past'
      }
      return { pair, state, change, isCurrent }
    })
}

// Следующая пара: первая, которая ещё не началась (по эффективному времени старта).
export function nextPair(dayPairs: DayPair[], now: NowInTz): DayPair | null {
  const upcoming = dayPairs.find((dp) => {
    if (dp.state === 'cancelled') return false
    const start = dp.change?.newStartTime ?? dp.pair.startTime
    return start > now.time
  })
  const current = dayPairs.find((dp) => dp.isCurrent)
  return current ?? upcoming ?? null
}
