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
 * Изменения одной пары на одну дату, сведённые в одно — по правилам `effectiveSlot` сервера,
 * по которому считаются конфликты и QR-окно: позднее перекрывает раннее, отмена — всё.
 * Перенос даёт время (и аудиторию, если указана), смена аудитории — аудиторию, замена —
 * преподавателя; тип и заметка — последнего изменения. Раньше веб брал только последнее:
 * после «перенос на 14:00» и «смена аудитории на 305» показывал 10:00 в 305.
 * Изменения — в порядке создания.
 */
export function mergeChanges(changes: ScheduleChange[]): ScheduleChange | null {
  const cancel = changes.find((c) => c.type === 'CANCELLED')
  if (cancel) return cancel
  // Через `as`: иначе TS сужает `merged` до null по начальному значению и в цикле.
  let merged = null as ScheduleChange | null
  for (const c of changes) {
    const moved = c.type === 'MOVED' && !!c.newStartTime && !!c.newEndTime
    const roomChanged = (c.type === 'ROOM_CHANGED' || c.type === 'MOVED') && !!c.newRoom
    const substituted = c.type === 'SUBSTITUTED' && !!c.newTeacher
    merged = {
      ...c,
      newStartTime: moved ? c.newStartTime : (merged?.newStartTime ?? null),
      newEndTime: moved ? c.newEndTime : (merged?.newEndTime ?? null),
      newRoom: roomChanged ? c.newRoom : (merged?.newRoom ?? null),
      newTeacher: substituted ? c.newTeacher : (merged?.newTeacher ?? null),
      note: c.note ?? merged?.note ?? null,
    }
  }
  return merged
}

/** Ключ «пара|дата» карты `changesByPairDate`. */
export function pairDateKey(pairId: string, date: string): string {
  return `${pairId}|${date.slice(0, 10)}`
}

/** Изменения, сведённые по паре и дате (`mergeChanges`), — для наложения на сетку и календарь. */
export function changesByPairDate(changes: ScheduleChange[]): Map<string, ScheduleChange> {
  const grouped = new Map<string, ScheduleChange[]>()
  for (const c of changes) {
    const key = pairDateKey(c.pairId, c.date)
    grouped.set(key, [...(grouped.get(key) ?? []), c])
  }
  const out = new Map<string, ScheduleChange>()
  for (const [key, list] of grouped) {
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const merged = mergeChanges(sorted)
    if (merged) out.set(key, merged)
  }
  return out
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
  const todayChanges = changesByPairDate(changes)

  return pairs
    .filter(
      (p) => p.dayOfWeek === now.dayOfWeek && (p.weekType === 'BOTH' || p.weekType === parity),
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((pair) => {
      const change = todayChanges.get(pairDateKey(pair.id, now.date)) ?? null
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

// ── Замены преподавателя (C-F12) ────────────────────────────────────────────

/**
 * Последняя замена пары на дату — она решает, кто ведёт занятие: ошибочную замену деканат
 * исправляет новой, отдельного редактирования нет. Изменения приходят по времени создания.
 */
export function substitutionOn(
  changes: ScheduleChange[],
  pairId: string,
  date: string,
): ScheduleChange | null {
  let found: ScheduleChange | null = null
  for (const c of changes) {
    if (c.type === 'SUBSTITUTED' && c.pairId === pairId && c.date.slice(0, 10) === date) found = c
  }
  return found
}

/**
 * Своё занятие на дату отдано другому преподавателю: вести и отмечать его будет заменяющий.
 * Замена без заменяющего (его аккаунт удалён) занятие у основного не забирает — как на сервере.
 */
export function isSubstitutedAway(
  changes: ScheduleChange[],
  pairId: string,
  date: string,
  teacherId: string,
): boolean {
  const sub = substitutionOn(changes, pairId, date)
  return !!sub?.newTeacher && sub.newTeacher.id !== teacherId
}

/**
 * Чужие пары, которые преподаватель ведёт на дату по замене. В его недельной выборке
 * (`GET /schedule`) их нет — пара строится из изменения, где API отдаёт её данные.
 */
export function substitutionPairs(
  changes: ScheduleChange[],
  date: string,
  teacherId: string,
): Pair[] {
  const out = new Map<string, Pair>()
  for (const c of changes) {
    if (c.type !== 'SUBSTITUTED' || c.date.slice(0, 10) !== date || out.has(c.pairId)) continue
    if (c.pair.teacher?.id === teacherId) continue
    if (substitutionOn(changes, c.pairId, date)?.newTeacher?.id !== teacherId) continue
    out.set(c.pairId, {
      id: c.pairId,
      scheduleId: c.pair.scheduleId ?? '',
      groupId: c.pair.groupId,
      subject: c.pair.subject,
      dayOfWeek: c.pair.dayOfWeek,
      startTime: c.pair.startTime,
      endTime: c.pair.endTime,
      weekType: c.pair.weekType ?? 'BOTH',
      teacher: c.pair.teacher ?? null,
      room: c.pair.room ?? null,
    })
  }
  return [...out.values()]
}

export { nowInTz, isoWeekParity }
export type { NowInTz }
