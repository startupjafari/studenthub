import { describe, expect, it } from 'vitest'
import { buildDayPairs, nextPair, type NowInTz } from './schedule-day'
import type { Pair, ScheduleChange } from '../../../entities/schedule'

function pair(o: Partial<Pair> = {}): Pair {
  return {
    id: 'p1',
    scheduleId: 's1',
    groupId: 'g1',
    subject: 'Math',
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '10:30',
    weekType: 'BOTH',
    teacher: null,
    room: null,
    ...o,
  }
}

function change(o: Partial<ScheduleChange> = {}): ScheduleChange {
  return {
    id: 'c1',
    pairId: 'p1',
    type: 'CANCELLED',
    date: '2026-06-15',
    newStartTime: null,
    newEndTime: null,
    note: null,
    createdAt: '2026-06-14T00:00:00.000Z',
    newRoom: null,
    newTeacher: null,
    pair: { groupId: 'g1', subject: 'Math', dayOfWeek: 1, startTime: '09:00', endTime: '10:30' },
    ...o,
  }
}

// Понедельник 2026-06-15.
const now = (time: string): NowInTz => ({ date: '2026-06-15', dayOfWeek: 1, time })

describe('buildDayPairs', () => {
  it('фильтрует по дню недели и чётности, сортирует по времени старта', () => {
    const pairs = [
      pair({ id: 'late', startTime: '11:00', endTime: '12:00' }),
      pair({ id: 'early', startTime: '09:00', endTime: '10:00' }),
      pair({ id: 'otherDay', dayOfWeek: 2 }),
      pair({ id: 'oddOnly', weekType: 'ODD', startTime: '13:00', endTime: '14:00' }),
    ]
    const r = buildDayPairs(pairs, [], now('08:00'), 'EVEN')
    expect(r.map((d) => d.pair.id)).toEqual(['early', 'late'])
  })

  it('BOTH-пара видна при любой чётности', () => {
    const r = buildDayPairs([pair({ weekType: 'BOTH' })], [], now('08:00'), 'ODD')
    expect(r).toHaveLength(1)
  })

  it('накладывает изменение → state по типу', () => {
    const r = buildDayPairs(
      [pair({ id: 'p1' })],
      [change({ pairId: 'p1', type: 'ROOM_CHANGED' })],
      now('08:00'),
      'ODD',
    )
    expect(r[0]!.state).toBe('room')
    expect(r[0]!.change).not.toBeNull()
  })

  it('идёт сейчас → now; закончилась → past; ещё не началась → normal', () => {
    const p = [pair({ id: 'p1', startTime: '09:00', endTime: '10:30' })]
    expect(buildDayPairs(p, [], now('09:30'), 'ODD')[0]!.state).toBe('now')
    expect(buildDayPairs(p, [], now('11:00'), 'ODD')[0]!.state).toBe('past')
    expect(buildDayPairs(p, [], now('08:00'), 'ODD')[0]!.state).toBe('normal')
  })

  it('отменённая пара не бывает «сейчас»', () => {
    const r = buildDayPairs(
      [pair({ id: 'p1', startTime: '09:00', endTime: '10:30' })],
      [change({ pairId: 'p1', type: 'CANCELLED' })],
      now('09:30'),
      'ODD',
    )
    expect(r[0]!.state).toBe('cancelled')
    expect(r[0]!.isCurrent).toBe(false)
  })

  it('изменения другого дня игнорируются', () => {
    const r = buildDayPairs(
      [pair({ id: 'p1' })],
      [change({ pairId: 'p1', date: '2026-06-16', type: 'CANCELLED' })],
      now('08:00'),
      'ODD',
    )
    expect(r[0]!.state).toBe('normal')
  })
})

describe('nextPair', () => {
  it('возвращает текущую, если идёт', () => {
    const day = buildDayPairs(
      [pair({ id: 'p1', startTime: '09:00', endTime: '10:30' })],
      [],
      now('09:30'),
      'ODD',
    )
    expect(nextPair(day, now('09:30'))?.pair.id).toBe('p1')
  })

  it('иначе — первую предстоящую', () => {
    const day = buildDayPairs(
      [
        pair({ id: 'a', startTime: '09:00', endTime: '10:00' }),
        pair({ id: 'b', startTime: '11:00', endTime: '12:00' }),
      ],
      [],
      now('10:30'),
      'ODD',
    )
    expect(nextPair(day, now('10:30'))?.pair.id).toBe('b')
  })

  it('нет предстоящих → null', () => {
    const day = buildDayPairs(
      [pair({ id: 'a', startTime: '09:00', endTime: '10:00' })],
      [],
      now('12:00'),
      'ODD',
    )
    expect(nextPair(day, now('12:00'))).toBeNull()
  })
})
