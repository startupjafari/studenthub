import { describe, expect, it } from 'vitest'
import { buildCalendar, calendarLinks, holidaysByDate, mapExams } from './calendar-events'
import { Role } from '@studenthub/shared-types'
import type { ExamItem } from '../../../entities/exam'

// Сетка месяца приходит 42 ячейками с хвостами соседних месяцев — карта праздников
// обязана покрывать и их, иначе Наурыз пропадал бы в апрельской сетке.

const days = (year: number, month: number, from: number, to: number): Date[] =>
  Array.from({ length: to - from + 1 }, (_, i) => new Date(year, month - 1, from + i))

describe('праздники в календаре', () => {
  it('размечает все дни праздника', () => {
    const map = holidaysByDate(days(2026, 3, 19, 25))
    expect(map.get('2026-03-20')?.id).toBe('oraza-ait')
    expect(map.get('2026-03-21')?.id).toBe('nauryz')
    expect(map.get('2026-03-23')?.id).toBe('nauryz')
    expect(map.has('2026-03-24')).toBe(false)
  })

  it('нерабочий день отличим от рабочего праздника', () => {
    const map = holidaysByDate(days(2026, 3, 20, 21))
    expect(map.get('2026-03-21')?.dayOff).toBe(true)
    // Ораза айт отмечают, но это рабочий день — календарь не имеет права утверждать обратное.
    expect(map.get('2026-03-20')?.dayOff).toBe(false)
  })

  it('день памяти показывается, а выключенный мягкий праздник — нет', () => {
    expect(holidaysByDate(days(2026, 5, 31, 31)).get('2026-05-31')?.id).toBe(
      'repression-victims-day',
    )
    expect(holidaysByDate(days(2026, 10, 31, 31)).has('2026-10-31')).toBe(false)
  })

  it('дни без праздника в карту не попадают', () => {
    expect(holidaysByDate(days(2026, 9, 24, 26)).size).toBe(0)
  })
})

// Экзамены — особое событие расписания (C-F22): раньше в календарь не попадали вовсе.
describe('экзамены в календаре', () => {
  const exam = {
    id: 'ex-1',
    date: new Date(2026, 5, 10, 9, 0).toISOString(),
    format: 'WRITTEN',
    maxScore: 100,
    note: null,
    createdAt: new Date(2026, 4, 1).toISOString(),
    groupId: 'grp-1',
    course: { id: 'c-1', teacherId: 't-1', subject: { id: 's-1', name: 'Матанализ' } },
    group: { id: 'grp-1', name: 'ИС-21' },
    room: { id: 'r-1', name: '305' },
    examiner: { id: 't-1', firstName: 'Айгуль', lastName: 'Бекова' },
  } satisfies ExamItem

  it('экзамен ложится на местный день и время начала, ведёт в «Экзамены»', () => {
    expect(mapExams([exam])).toEqual([
      expect.objectContaining({
        id: 'exam-ex-1',
        date: '2026-06-10',
        start: '09:00',
        title: 'Матанализ',
        subtitle: '305 · Айгуль Бекова',
        type: 'exam',
        href: '/exams',
      }),
    ])
  })

  it('фильтр «Экзамены» оставляет только экзамены', () => {
    const items = buildCalendar([], [], [], [], [], 'exam', [exam])
    expect(items.map((i) => i.type)).toEqual(['exam'])
    expect(buildCalendar([], [], [], [], [], 'pair', [exam])).toEqual([])
  })

  it('преподавателя и декана календарь ведёт на их экраны, а не на студенческие', () => {
    const teacher = buildCalendar(
      [],
      [],
      [],
      [],
      [],
      'exam',
      [exam],
      null,
      calendarLinks(Role.TEACHER),
    )
    expect(teacher[0]?.href).toBe('/teacher/exams')
    expect(calendarLinks(Role.DEAN).exam).toBe('/dean/exams')
    expect(calendarLinks(Role.STAROSTA).assignment).toBe('/assignments')
  })
})
