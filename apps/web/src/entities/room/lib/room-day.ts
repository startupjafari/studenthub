import { buildDayPairs, isoWeekParity, nextPair, type DayPair } from '../../schedule'
import type { RoomPair, RoomStatusResponse } from '../model/types'

// Ф16: «занято или свободно» для страницы помещения по QR.
// Считается из тех же данных и теми же хелперами, что сетка расписания и экран «Сегодня»
// (buildDayPairs/isoWeekParity), иначе два экрана расходились бы в показаниях.

export type Occupancy =
  // Учебное помещение: идёт пара / не идёт.
  | 'busy'
  | 'free'
  // Неучебное (библиотека, бухгалтерия): расписания пар нет, судить не можем.
  | 'unknown'

export interface RoomStatus {
  occupancy: Occupancy
  /** Пара, идущая прямо сейчас (null — свободно). */
  current: DayPair<RoomPair> | null
  /** Следующая пара сегодня. */
  next: DayPair<RoomPair> | null
  /** Весь день в этом помещении — по всем группам, с изменениями. */
  day: DayPair<RoomPair>[]
  /** До какого времени занято (конец текущей пары). */
  busyUntil: string | null
  /** До какого времени свободно (начало следующей пары); null — до конца дня. */
  freeUntil: string | null
}

export function buildRoomStatus(data: RoomStatusResponse): RoomStatus {
  // Дата берётся с сервера — от неё же считаем чётность недели, иначе телефон с уехавшими
  // часами показал бы расписание другой недели.
  const parity = isoWeekParity(new Date(`${data.now.date}T12:00:00`))
  const day = buildDayPairs(data.pairs, data.changes, data.now, parity).filter((dp) =>
    isInRoom(dp, data.room.id),
  )

  const current = day.find((dp) => dp.isCurrent && dp.state !== 'cancelled') ?? null
  const upcoming = day.find((dp) => dp.state !== 'cancelled' && startOf(dp) > data.now.time) ?? null

  return {
    occupancy: !data.academic ? 'unknown' : current ? 'busy' : 'free',
    current,
    next: nextPair(day, data.now),
    day,
    busyUntil: current ? endOf(current) : null,
    freeUntil: current ? null : (upcoming && startOf(upcoming)) || null,
  }
}

/**
 * Пара относится к этому помещению?
 *
 * Учитывает переносы в обе стороны: пару могли увести отсюда (ROOM_CHANGED на другую
 * аудиторию — тогда здесь свободно) или привести сюда из другой. Эффективная аудитория —
 * из изменения, иначе из самой пары.
 */
function isInRoom(dp: DayPair<RoomPair>, roomId: string): boolean {
  const effectiveRoomId = dp.change?.newRoom?.id ?? dp.pair.room?.id ?? null
  return effectiveRoomId === roomId
}

function startOf(dp: DayPair<RoomPair>): string {
  return dp.change?.newStartTime ?? dp.pair.startTime
}

function endOf(dp: DayPair<RoomPair>): string {
  return dp.change?.newEndTime ?? dp.pair.endTime
}
