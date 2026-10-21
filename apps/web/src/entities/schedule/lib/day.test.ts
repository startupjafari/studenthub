import { describe, expect, it } from 'vitest'
import { isSubstitutedAway, substitutionOn, substitutionPairs } from './day'
import type { ScheduleChange } from '../model/types'

const MAIN = { id: 't-main', firstName: 'Анна', lastName: 'Основная' }
const SUB = { id: 't-sub', firstName: 'Борис', lastName: 'Заменяющий' }
const OTHER = { id: 't-other', firstName: 'Вера', lastName: 'Другая' }
const DATE = '2026-09-15'

function change(o: Partial<ScheduleChange> = {}): ScheduleChange {
  return {
    id: 'c1',
    pairId: 'p1',
    type: 'SUBSTITUTED',
    date: `${DATE}T00:00:00.000Z`,
    newStartTime: null,
    newEndTime: null,
    note: null,
    createdAt: '2026-09-10T00:00:00.000Z',
    newRoom: null,
    newTeacher: SUB,
    pair: {
      scheduleId: 's1',
      groupId: 'g1',
      subject: 'Матанализ',
      dayOfWeek: 2,
      startTime: '09:00',
      endTime: '10:30',
      weekType: 'ODD',
      teacher: MAIN,
      room: { id: 'r1', name: '101' },
    },
    ...o,
  }
}

// C-F12: замена преподавателя доходит до заменяющего.
describe('замены преподавателя', () => {
  it('последняя замена пары на дату решает, кто ведёт занятие', () => {
    const changes = [change({ id: 'c1' }), change({ id: 'c2', newTeacher: OTHER })]
    expect(substitutionOn(changes, 'p1', DATE)?.id).toBe('c2')
    expect(substitutionOn(changes, 'p1', '2026-09-16')).toBeNull()
  })

  it('заменяющему — чужая пара на дату, с данными пары из изменения', () => {
    const [p] = substitutionPairs([change()], DATE, SUB.id)
    expect(p).toEqual({
      id: 'p1',
      scheduleId: 's1',
      groupId: 'g1',
      subject: 'Матанализ',
      dayOfWeek: 2,
      startTime: '09:00',
      endTime: '10:30',
      weekType: 'ODD',
      teacher: MAIN,
      room: { id: 'r1', name: '101' },
    })
  })

  it('замена переназначена на другого — прежнему заменяющему пара не достаётся', () => {
    const changes = [change({ id: 'c1' }), change({ id: 'c2', newTeacher: OTHER })]
    expect(substitutionPairs(changes, DATE, SUB.id)).toEqual([])
    expect(substitutionPairs(changes, DATE, OTHER.id).map((p) => p.id)).toEqual(['p1'])
  })

  it('другие типы изменений и другие даты пару по замене не дают', () => {
    const changes = [
      change({ type: 'CANCELLED', newTeacher: null }),
      change({ id: 'c3', date: '2026-09-22T00:00:00.000Z' }),
    ]
    expect(substitutionPairs(changes, DATE, SUB.id)).toEqual([])
  })

  it('основной преподаватель на дату замены пару не ведёт; без заменяющего — ведёт', () => {
    expect(isSubstitutedAway([change()], 'p1', DATE, MAIN.id)).toBe(true)
    expect(isSubstitutedAway([change()], 'p1', DATE, SUB.id)).toBe(false)
    // Аккаунт заменяющего удалён (newTeacher = null) — занятие снова за основным.
    expect(isSubstitutedAway([change({ newTeacher: null })], 'p1', DATE, MAIN.id)).toBe(false)
  })
})
