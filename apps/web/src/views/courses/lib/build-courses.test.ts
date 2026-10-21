import { describe, expect, it } from 'vitest'
import type { Pair } from '../../../entities/schedule'
import type { CourseItem } from '../../../entities/course'
import { isoWeekParity, type NowInTz } from '../../../shared/lib'
import {
  buildCourses,
  courseHref,
  courseKey,
  mergeApiCourses,
  pickCourse,
  type CourseSummary,
} from './build-courses'

// 2026-10-19 — понедельник.
const MONDAY: NowInTz = { date: '2026-10-19', dayOfWeek: 1, time: '10:00' }

const ivanov = { id: 't-1', firstName: 'Иван', lastName: 'Иванов' }
const petrova = { id: 't-2', firstName: 'Анна', lastName: 'Петрова' }

function pair(over: Partial<Pair> = {}): Pair {
  return {
    id: over.id ?? `p-${Math.random().toString(36).slice(2)}`,
    scheduleId: 'sch-1',
    groupId: 'g-1',
    subject: 'Математика',
    dayOfWeek: 1,
    startTime: '11:00',
    endTime: '12:30',
    weekType: 'BOTH',
    teacher: ivanov,
    room: { id: 'r-1', name: '101' },
    ...over,
  }
}

function course(over: Partial<CourseItem> & { id: string }): CourseItem {
  return {
    credits: 5,
    createdAt: '2026-01-01T00:00:00.000Z',
    subject: { id: 's-math', name: 'Математика', code: null },
    group: { id: 'g-1', name: 'ИС-21' },
    teacher: petrova,
    term: null,
    ...over,
  }
}

const term = (name: string, isActive: boolean, number = 1) => ({
  id: `term-${name}`,
  name,
  number,
  isActive,
})

describe('buildCourses — дисциплины из расписания', () => {
  it('без пар — пусто', () => {
    expect(buildCourses([], [], MONDAY)).toEqual([])
  })

  it('пары одного названия — одна карточка: занятия в неделю, преподаватели без повторов', () => {
    const courses = buildCourses(
      [
        pair({ dayOfWeek: 1 }),
        pair({ dayOfWeek: 3, teacher: petrova }),
        pair({ dayOfWeek: 5 }),
        pair({ subject: 'Физика', teacher: null }),
      ],
      [],
      MONDAY,
    )
    expect(courses.map((c) => c.subject)).toEqual(['Математика', 'Физика'])
    expect(courses[0]).toMatchObject({
      lessonsPerWeek: 3,
      teachers: [ivanov, petrova],
      courseId: null,
      credits: null,
      termName: null,
    })
    expect(courses[1]?.teachers).toEqual([])
  })

  it('число материалов — из серверных счётчиков; материалы без дисциплины не в счёт', () => {
    const courses = buildCourses(
      [pair(), pair({ subject: 'Физика' })],
      [
        { subject: 'Математика', count: 240 },
        { subject: null, count: 7 },
      ],
      MONDAY,
    )
    expect(courses.find((c) => c.subject === 'Математика')?.materialsCount).toBe(240)
    expect(courses.find((c) => c.subject === 'Физика')?.materialsCount).toBe(0)
  })

  describe('ближайшее занятие', () => {
    it('сегодня позже текущего времени — сегодня, самое раннее из оставшихся', () => {
      const [math] = buildCourses(
        [
          pair({ startTime: '14:00', room: { id: 'r-2', name: '202' } }),
          pair({ startTime: '11:00' }),
          pair({ startTime: '08:30' }),
        ],
        [],
        MONDAY,
      )
      expect(math?.next).toEqual({ inDays: 0, dayOfWeek: 1, startTime: '11:00', room: '101' })
    })

    it('сегодняшнее уже прошло — следующий день с парой', () => {
      const [math] = buildCourses(
        [pair({ startTime: '08:30' }), pair({ dayOfWeek: 3, startTime: '09:00', room: null })],
        [],
        MONDAY,
      )
      expect(math?.next).toEqual({ inDays: 2, dayOfWeek: 3, startTime: '09:00', room: null })
    })

    it('единственная пара сегодня уже прошла — она же через неделю', () => {
      const [math] = buildCourses([pair({ startTime: '08:30' })], [], MONDAY)
      expect(math?.next).toMatchObject({ inDays: 7, dayOfWeek: 1, startTime: '08:30' })
    })

    it('пара по чётным/нечётным — только в неделю своей чётности', () => {
      const thisWeek = isoWeekParity(new Date(2026, 9, 21))
      const otherParity = thisWeek === 'ODD' ? 'EVEN' : 'ODD'
      const [math] = buildCourses([pair({ dayOfWeek: 3, weekType: otherParity })], [], MONDAY)
      // Среда этой недели не подходит по чётности — следующая среда.
      expect(math?.next).toMatchObject({ inDays: 9, dayOfWeek: 3 })
    })
  })
})

describe('mergeApiCourses — курсы поверх расписания (C-F25)', () => {
  const base = () => buildCourses([pair()], [{ subject: 'Математика', count: 4 }], MONDAY)

  it('без курсов — расписание как есть', () => {
    const b = base()
    expect(mergeApiCourses(b, [])).toBe(b)
  })

  it('одна дисциплина в двух семестрах — две карточки; пары — у курса текущего семестра', () => {
    const past = course({ id: 'c-past', term: term('Осень 2025', false), credits: 4 })
    const current = course({ id: 'c-now', term: term('Осень 2026', true, 2), credits: 6 })
    for (const api of [
      [past, current],
      [current, past],
    ]) {
      const merged = mergeApiCourses(base(), api)
      expect(merged.map((c) => [c.courseId, c.lessonsPerWeek])).toEqual([
        ['c-now', 1],
        ['c-past', 0],
      ])
      expect(merged[0]).toMatchObject({
        credits: 6,
        termName: 'Осень 2026',
        materialsCount: 4,
        teachers: [ivanov],
      })
      expect(merged[1]).toMatchObject({
        subject: 'Математика',
        credits: 4,
        termName: 'Осень 2025',
        materialsCount: 0,
        next: null,
        teachers: [petrova],
      })
    }
  })

  it('без активного семестра: курс без семестра, затем самый свежий', () => {
    const old = course({
      id: 'c-old',
      term: term('2024', false),
      createdAt: '2024-09-01T00:00:00.000Z',
    })
    const recent = course({
      id: 'c-recent',
      term: term('2025', false),
      createdAt: '2025-09-01T00:00:00.000Z',
    })
    const termless = course({ id: 'c-none', createdAt: '2023-01-01T00:00:00.000Z' })
    expect(mergeApiCourses(base(), [old, recent, termless]).map((c) => c.courseId)).toEqual([
      'c-none',
      'c-recent',
      'c-old',
    ])
    expect(mergeApiCourses(base(), [old, recent]).map((c) => c.courseId)).toEqual([
      'c-recent',
      'c-old',
    ])
  })

  it('курс без пар в расписании — своя карточка с преподавателем курса, по алфавиту', () => {
    const history = course({
      id: 'c-hist',
      subject: { id: 's-hist', name: 'История', code: null },
      teacher: null,
    })
    const algebra = course({
      id: 'c-alg',
      subject: { id: 's-alg', name: 'Алгебра', code: 'ALG' },
    })
    const merged = mergeApiCourses(base(), [history, algebra])
    expect(merged.map((c) => c.subject)).toEqual(['Алгебра', 'История', 'Математика'])
    expect(merged[0]).toMatchObject({ courseId: 'c-alg', lessonsPerWeek: 0, teachers: [petrova] })
    expect(merged[1]?.teachers).toEqual([])
    // Карточка из расписания без курса остаётся без courseId.
    expect(merged[2]?.courseId).toBeNull()
  })

  it('у пар без преподавателя — преподаватель курса; с преподавателем — из пар', () => {
    const noTeacher = buildCourses([pair({ teacher: null })], [], MONDAY)
    expect(mergeApiCourses(noTeacher, [course({ id: 'c-1' })])[0]?.teachers).toEqual([petrova])
    expect(mergeApiCourses(base(), [course({ id: 'c-1' })])[0]?.teachers).toEqual([ivanov])
  })
})

describe('ссылка и выбор карточки дисциплины', () => {
  const summary = (over: Partial<CourseSummary>): CourseSummary => ({
    subject: 'Математика',
    teachers: [],
    lessonsPerWeek: 0,
    materialsCount: 0,
    next: null,
    courseId: null,
    credits: null,
    termName: null,
    ...over,
  })
  const primary = summary({ courseId: 'c-now', lessonsPerWeek: 2 })
  const past = summary({ courseId: 'c-past' })
  const list = [primary, past, summary({ subject: 'Физика', lessonsPerWeek: 1 })]

  it('ссылка: путь по названию, курс — параметром', () => {
    expect(courseHref(past)).toBe(`/courses/${encodeURIComponent('Математика')}?course=c-past`)
    expect(courseHref(summary({ subject: 'C++ / ООП' }))).toBe(
      '/courses/C%2B%2B%20%2F%20%D0%9E%D0%9E%D0%9F',
    )
  })

  it('ключ: id курса, без курса — название', () => {
    expect(courseKey(past)).toBe('c-past')
    expect(courseKey(summary({ subject: 'Физика' }))).toBe('subject:Физика')
  })

  it('по id из ссылки — тот самый курс, а не первый с таким названием', () => {
    expect(pickCourse(list, 'Математика', 'c-past')).toBe(past)
  })

  it('без id или с неизвестным id — основная карточка с этим названием', () => {
    expect(pickCourse(list, 'Математика', null)).toBe(primary)
    expect(pickCourse(list, 'Математика', 'c-gone')).toBe(primary)
    expect(pickCourse(list, 'Химия', null)).toBeUndefined()
  })
})
