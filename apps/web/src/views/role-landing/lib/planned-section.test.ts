import { describe, expect, it } from 'vitest'
import { isPlannedSection } from './planned-section'

// B-F26: заглушка «в разработке» — только для пунктов навигации, опечатка — 404.
describe('isPlannedSection', () => {
  it('опечатка в адресе раздела — не раздел', () => {
    expect(isPlannedSection('dean', '/dean/studnets')).toBe(false)
  })

  it('вложенный путь под существующим разделом — не раздел', () => {
    expect(isPlannedSection('dean', '/dean/students/abc')).toBe(false)
  })

  it('адрес из навигации роли — раздел (в том числе со слэшем на конце)', () => {
    expect(isPlannedSection('dean', '/dean/students')).toBe(true)
    expect(isPlannedSection('dean', '/dean/students/')).toBe(true)
  })

  it('раздел другой роли в этой зоне не считается', () => {
    expect(isPlannedSection('teacher', '/dean/students')).toBe(false)
  })

  it('зоны модераторов сверяются со своими навигациями', () => {
    expect(isPlannedSection('platform-moderator', '/moderator/platform/complaints')).toBe(true)
    expect(isPlannedSection('university-moderator', '/moderator/university/nope')).toBe(false)
  })
})
