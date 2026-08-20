import type { Pair, ScheduleChange } from '../model/types'
import { nowInTz, isoWeekParity, type NowInTz } from '../../../shared/lib'

// «День расписания»: пары на конкретный день с наложенными изменениями и признаком
// «идёт сейчас». Живёт в entities/schedule, потому что используется несколькими
// не связанными экранами — «Сегодня», «Курсы», «Явка» и страница помещения по QR (Ф16).
// Один источник истины: иначе страница по QR показывала бы одно, а сетка расписания — другое.

export type PairState = 'normal' | 'cancelled' | 'moved' | 'room' | 'substituted' | 'past' | 'now'

export interface DayPair<T extends Pair = Pair> {
  pair: T
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

/**
 * Пары на сегодня с наложенными изменениями и признаком «сейчас/прошло».
 *
 * Дженерик по типу пары: страница помещения передаёт пару с именем группы
 * (`RoomPair`), и это имя не должно теряться на выходе.
 */
export function buildDayPairs<T extends Pair>(
  pairs: T[],
  changes: ScheduleChange[],
  now: NowInTz,
  parity: 'ODD' | 'EVEN',
): DayPair<T>[] {
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

/** Следующая пара: первая, которая ещё не началась (по эффективному времени старта). */
export function nextPair<T extends Pair>(dayPairs: DayPair<T>[], now: NowInTz): DayPair<T> | null {
  const upcoming = dayPairs.find((dp) => {
    if (dp.state === 'cancelled') return false
    const start = dp.change?.newStartTime ?? dp.pair.startTime
    return start > now.time
  })
  const current = dayPairs.find((dp) => dp.isCurrent)
  return current ?? upcoming ?? null
}

export { nowInTz, isoWeekParity }
export type { NowInTz }
