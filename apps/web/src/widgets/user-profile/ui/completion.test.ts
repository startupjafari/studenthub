import { describe, expect, it } from 'vitest'
import { Role } from '@studenthub/shared-types'
import { computeProfileCompletion } from './completion'
import { visibleSections } from './sections'

// Заполненность считается только по полям, доступным роли. Раньше в знаменатель
// попадал весь блок «Работа» (кафедра, учёная степень, предметы), и платформенный
// админ не мог дойти до 100% — плашка висела вечно.

/** Профиль, где заполнены все доступные роли поля (+ аватар и подпись из шапки). */
function fullProfileFor(role: Role): Record<string, unknown> {
  const data: Record<string, unknown> = { avatarUrl: 'a.webp', headline: 'Дежурный' }
  for (const section of visibleSections(role)) {
    for (const f of section.fields) {
      data[f.key] = f.type === 'list' ? ['x'] : f.type === 'number' ? 1 : 'x'
    }
  }
  return data
}

describe('computeProfileCompletion', () => {
  it('платформенный админ может дойти до 100%', () => {
    const r = computeProfileCompletion(fullProfileFor(Role.PLATFORM_ADMIN), Role.PLATFORM_ADMIN)
    expect(r.percent).toBe(100)
    expect(r.missing).toEqual([])
  })

  it.each([Role.STUDENT, Role.STAROSTA, Role.TEACHER, Role.DEAN, Role.UNIVERSITY_ADMIN])(
    'роль %s может дойти до 100%%',
    (role) => {
      expect(computeProfileCompletion(fullProfileFor(role), role).percent).toBe(100)
    },
  )

  it('не требует у платформенного админа академических полей', () => {
    const r = computeProfileCompletion({}, Role.PLATFORM_ADMIN)
    const keys = r.missing.map((m) => m.key)
    expect(keys).not.toContain('academicDegree')
    expect(keys).not.toContain('department')
    expect(keys).not.toContain('subjects')
    expect(keys).not.toContain('employeeNumber')
    // Служебный минимум, наоборот, спрашивается.
    expect(keys).toContain('responsibilities')
    expect(keys).toContain('workPhone')
    expect(keys).toContain('timezone')
  })

  it('у преподавателя академические поля остаются, студенческие — нет', () => {
    const keys = computeProfileCompletion({}, Role.TEACHER).missing.map((m) => m.key)
    expect(keys).toContain('academicDegree')
    expect(keys).toContain('department')
    expect(keys).not.toContain('gpa')
    expect(keys).not.toContain('dormitory')
  })
})

describe('visibleSections', () => {
  it('у платформенного админа нет пустых секций «Академическое» и «Учёба»', () => {
    const titles = visibleSections(Role.PLATFORM_ADMIN).map((s) => s.title)
    expect(titles).not.toContain('sectionAcademic')
    expect(titles).not.toContain('sectionStudy')
    expect(titles).not.toContain('sectionInterests')
    expect(titles).toContain('sectionWork')
    expect(titles).toContain('sectionContacts')
  })

  it('секция «Академическое» есть у преподавателя и декана', () => {
    for (const role of [Role.TEACHER, Role.DEAN]) {
      expect(visibleSections(role).map((s) => s.title)).toContain('sectionAcademic')
    }
  })

  it('«Интересы и навыки» — только у студенческих ролей', () => {
    expect(visibleSections(Role.STUDENT).map((s) => s.title)).toContain('sectionInterests')
    expect(visibleSections(Role.TEACHER).map((s) => s.title)).not.toContain('sectionInterests')
  })
})
