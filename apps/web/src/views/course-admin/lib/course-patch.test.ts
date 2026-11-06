import { describe, expect, it } from 'vitest'
import type { CourseItem } from '../../../entities/course'
import { buildCoursePatch, courseEditDefaults } from './course-patch'

// Правка курса уходит PATCH-ем только по изменённым полям: неизменный преподаватель не
// должен попадать в тело, иначе сервер заново его проверяет и правка кредитов падает.

const course = (over: Partial<CourseItem> = {}): CourseItem => ({
  id: 'c1',
  credits: 5,
  createdAt: '2026-09-01T00:00:00.000Z',
  subject: { id: 's1', name: 'Алгебра', code: null },
  group: { id: 'g1', name: 'ИС-21' },
  teacher: { id: 't1', firstName: 'Айгуль', lastName: 'Сапарова' },
  term: { id: 'tm1', name: 'Осень 2026', number: 1, isActive: true },
  ...over,
})

describe('правка курса', () => {
  it('без изменений тело пустое', () => {
    const c = course()
    expect(buildCoursePatch(c, courseEditDefaults(c))).toEqual({})
  })

  it('назначает преподавателя курсу, у которого его не было', () => {
    const c = course({ teacher: null })
    expect(buildCoursePatch(c, { ...courseEditDefaults(c), teacherId: 't2' })).toEqual({
      teacherId: 't2',
    })
  })

  it('снимает преподавателя явным null', () => {
    const c = course()
    expect(buildCoursePatch(c, { ...courseEditDefaults(c), teacherId: null })).toEqual({
      teacherId: null,
    })
  })

  it('правка кредитов не тащит прежнего преподавателя и семестр', () => {
    const c = course()
    expect(buildCoursePatch(c, { ...courseEditDefaults(c), credits: 6 })).toEqual({ credits: 6 })
  })

  it('пустые поля формы снимают семестр и кредиты', () => {
    const c = course()
    expect(buildCoursePatch(c, { teacherId: 't1', termId: undefined, credits: null })).toEqual({
      termId: null,
      credits: null,
    })
  })
})
