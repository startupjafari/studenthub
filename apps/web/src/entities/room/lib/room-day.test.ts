import { describe, expect, it } from 'vitest'
import { buildRoomStatus } from './room-day'
import type { RoomPair, RoomStatusResponse } from '../model/types'

// Ф16. Смысл этих тестов: наклейка на двери не должна врать. «Занято», когда пара
// отменена или переехала, — хуже, чем отсутствие QR вообще.

// 2026-08-24 — понедельник; ISO-неделя 35 → чётность EVEN.
const MONDAY = '2026-08-24'

const pair = (over: Partial<RoomPair> = {}): RoomPair => ({
  id: 'p-1',
  scheduleId: 's-1',
  groupId: 'g-1',
  subject: 'Матанализ',
  dayOfWeek: 1,
  startTime: '09:00',
  endTime: '10:30',
  weekType: 'BOTH',
  group: { id: 'g-1', name: 'ИТ-24-1' },
  teacher: { id: 't-1', firstName: 'Асель', lastName: 'Нурлан' },
  room: { id: 'room-1', name: '305' },
  ...over,
})

const data = (over: Partial<RoomStatusResponse> = {}): RoomStatusResponse => ({
  room: {
    id: 'room-1',
    name: '305',
    kind: 'AUDITORIUM',
    building: 'Б',
    floor: 3,
    capacity: 30,
    openHours: null,
    phone: null,
    info: null,
    university: 'КазНУ',
    universityShort: 'КазНУ',
  },
  academic: true,
  timezone: 'Asia/Almaty',
  now: { date: MONDAY, time: '09:40', dayOfWeek: 1 },
  pairs: [pair()],
  changes: [],
  ...over,
})

const change = (over: Record<string, unknown> = {}) => ({
  id: 'c-1',
  pairId: 'p-1',
  type: 'CANCELLED' as const,
  date: MONDAY,
  newStartTime: null,
  newEndTime: null,
  note: null,
  createdAt: MONDAY,
  newRoom: null,
  newTeacher: null,
  pair: {
    groupId: 'g-1',
    subject: 'Матанализ',
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '10:30',
  },
  ...over,
})

describe('buildRoomStatus', () => {
  it('идёт пара — занято, с группой и временем окончания', () => {
    const status = buildRoomStatus(data())

    expect(status.occupancy).toBe('busy')
    expect(status.current?.pair.group?.name).toBe('ИТ-24-1')
    expect(status.busyUntil).toBe('10:30')
    expect(status.freeUntil).toBeNull()
  })

  it('между парами — свободно до начала следующей', () => {
    const status = buildRoomStatus(
      data({
        now: { date: MONDAY, time: '10:45', dayOfWeek: 1 },
        pairs: [pair(), pair({ id: 'p-2', startTime: '11:00', endTime: '12:30' })],
      }),
    )

    expect(status.occupancy).toBe('free')
    expect(status.freeUntil).toBe('11:00')
    expect(status.next?.pair.id).toBe('p-2')
  })

  it('пара отменена — помещение свободно, а не занято', () => {
    const status = buildRoomStatus(data({ changes: [change()] }))

    expect(status.occupancy).toBe('free')
    expect(status.current).toBeNull()
    // Отменённая пара остаётся в списке дня — студенту важно видеть, что она была отменена.
    expect(status.day[0]?.state).toBe('cancelled')
  })

  it('пару увели в другую аудиторию — здесь свободно', () => {
    const status = buildRoomStatus(
      data({
        changes: [change({ type: 'ROOM_CHANGED', newRoom: { id: 'room-9', name: '111' } })],
      }),
    )

    expect(status.occupancy).toBe('free')
    expect(status.day).toHaveLength(0)
  })

  it('пару перенесли сюда из другой аудитории — здесь занято', () => {
    const status = buildRoomStatus(
      data({
        pairs: [pair({ id: 'p-3', room: { id: 'room-9', name: '111' } })],
        changes: [
          change({ pairId: 'p-3', type: 'ROOM_CHANGED', newRoom: { id: 'room-1', name: '305' } }),
        ],
      }),
    )

    expect(status.occupancy).toBe('busy')
    expect(status.current?.pair.id).toBe('p-3')
  })

  it('перенос по времени учитывается в «занято»', () => {
    const status = buildRoomStatus(
      data({
        now: { date: MONDAY, time: '13:10', dayOfWeek: 1 },
        changes: [change({ type: 'MOVED', newStartTime: '13:00', newEndTime: '14:30' })],
      }),
    )

    expect(status.occupancy).toBe('busy')
    expect(status.busyUntil).toBe('14:30')
  })

  it('пара другой чётности недели не считается занятостью', () => {
    // MONDAY = чётная неделя, пара только на нечётной.
    const status = buildRoomStatus(data({ pairs: [pair({ weekType: 'ODD' })] }))

    expect(status.occupancy).toBe('free')
    expect(status.day).toHaveLength(0)
  })

  it('изменение на другую дату не влияет на сегодня', () => {
    const status = buildRoomStatus(data({ changes: [change({ date: '2026-08-25' })] }))

    expect(status.occupancy).toBe('busy')
  })

  it('библиотека — судить о занятости нечем, но экран не падает', () => {
    const status = buildRoomStatus(
      data({
        academic: false,
        pairs: [],
        room: { ...data().room, kind: 'LIBRARY', openHours: 'Пн–Пт 09:00–18:00' },
      }),
    )

    expect(status.occupancy).toBe('unknown')
    expect(status.day).toEqual([])
    expect(status.current).toBeNull()
  })
})
