import { describe, expect, it } from 'vitest'
import { Role } from '@studenthub/shared-types'
import { searchHrefsFor } from './search-hrefs'

describe('searchHrefsFor', () => {
  it('студент — экран сдачи задания и Course Workspace', () => {
    const h = searchHrefsFor(Role.STUDENT)
    expect(h.assignment?.('a1')).toBe('/assignments?open=a1')
    expect(h.course?.('Матанализ')).toBe(`/courses/${encodeURIComponent('Матанализ')}`)
    expect(h.material?.(null)).toBe('/courses')
  })

  it('преподаватель — экран проверки, а не сдачи', () => {
    const h = searchHrefsFor(Role.TEACHER)
    expect(h.assignment?.('a1')).toBe('/teacher/assignments?open=a1')
    expect(h.material?.('Матанализ')).toBe('/teacher/materials')
    expect(h.chat('c1')).toBe('/teacher/chats?chat=c1')
  })

  it('декан и админ вуза — управление дисциплинами своего раздела', () => {
    expect(searchHrefsFor(Role.DEAN).course?.('x')).toBe('/dean/courses')
    expect(searchHrefsFor(Role.UNIVERSITY_ADMIN).assignment?.('a1')).toBe(
      '/university-admin/courses',
    )
  })

  it('модератору учебных экранов нет — строки не показываются', () => {
    const h = searchHrefsFor(Role.UNIVERSITY_MODERATOR)
    expect(h.course).toBeNull()
    expect(h.assignment).toBeNull()
    expect(h.material).toBeNull()
  })

  it('событие и чат открываются сами, а не список раздела', () => {
    const h = searchHrefsFor(Role.STUDENT)
    expect(h.event('e1')).toBe('/events/e1')
    expect(h.chat('c1')).toBe('/chats?chat=c1')
    expect(searchHrefsFor(Role.DEAN).event('e1')).toBe('/events/e1')
  })
})
