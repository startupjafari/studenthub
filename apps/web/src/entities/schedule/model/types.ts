// Типы расписания — зеркало ответов API (docs/PROJECT.md §3.1, Ф6).
// Время — «настенное» "HH:mm" в таймзоне вуза; dayOfWeek по ISO 1=пн…7=вс.

export type WeekType = 'ODD' | 'EVEN' | 'BOTH'

export type ScheduleChangeType = 'MOVED' | 'ROOM_CHANGED' | 'CANCELLED' | 'SUBSTITUTED'

export interface PairTeacher {
  id: string
  firstName: string
  lastName: string
}

export interface PairRoom {
  id: string
  name: string
}

export interface Pair {
  id: string
  scheduleId: string
  groupId: string
  subject: string
  dayOfWeek: number
  startTime: string
  endTime: string
  weekType: WeekType
  teacher: PairTeacher | null
  room: PairRoom | null
}

// Ответ GET /schedule (ролевая выборка + таймзона вуза).
export interface ScheduleResponse {
  timezone: string | null
  pairs: Pair[]
}

// Контейнер расписания группы.
export interface ScheduleContainer {
  id: string
  groupId: string
  name: string
  isActive: boolean
  createdAt: string
}

// GET /schedules/:id — контейнер с парами и таймзоной.
export interface ScheduleContainerDetail extends ScheduleContainer {
  timezone: string
  pairs: Pair[]
}

export interface ScheduleChange {
  id: string
  pairId: string
  type: ScheduleChangeType
  date: string
  newStartTime: string | null
  newEndTime: string | null
  note: string | null
  createdAt: string
  newRoom: PairRoom | null
  newTeacher: PairTeacher | null
  pair: {
    groupId: string
    subject: string
    dayOfWeek: number
    startTime: string
    endTime: string
  }
}
