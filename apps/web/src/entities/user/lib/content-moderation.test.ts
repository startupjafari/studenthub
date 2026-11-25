import { describe, expect, it } from 'vitest'
import { Role } from '@studenthub/shared-types'
import { contentModeration, type ContentModerator, type ContentOwner } from './content-moderation'

// Пункт «Удалить (модерация)» в чужом профиле: роль модерации, scope владельца и ранг выше.
const owner = (over: Partial<ContentOwner> = {}): ContentOwner => ({
  id: 'stud',
  role: Role.STUDENT,
  universityId: 'u1',
  facultyId: 'f1',
  ...over,
})
const viewer = (role: Role, over: Partial<ContentModerator> = {}): ContentModerator => ({
  id: 'me',
  role,
  universityId: null,
  facultyId: null,
  ...over,
})

describe('contentModeration', () => {
  it('платформа снимает контент в любом вузе', () => {
    expect(contentModeration(viewer(Role.PLATFORM_MODERATOR), owner())).toEqual({
      content: true,
      comments: true,
    })
  })

  it('модератор вуза — только свой вуз', () => {
    const mod = viewer(Role.UNIVERSITY_MODERATOR, { universityId: 'u1' })
    expect(contentModeration(mod, owner()).content).toBe(true)
    expect(contentModeration(mod, owner({ universityId: 'u2' }))).toEqual({
      content: false,
      comments: false,
    })
  })

  it('декан — только свой факультет', () => {
    const dean = viewer(Role.DEAN, { universityId: 'u1', facultyId: 'f1' })
    expect(contentModeration(dean, owner()).content).toBe(true)
    expect(contentModeration(dean, owner({ facultyId: 'f2' })).content).toBe(false)
  })

  it('контент владельца не ниже по роли не снимается, комментарии под ним — да', () => {
    const mod = viewer(Role.UNIVERSITY_MODERATOR, { universityId: 'u1' })
    expect(contentModeration(mod, owner({ role: Role.UNIVERSITY_ADMIN }))).toEqual({
      content: false,
      comments: true,
    })
  })

  it('роли без модерации и свой профиль — ничего', () => {
    for (const role of [Role.TEACHER, Role.STAROSTA, Role.STUDENT, Role.EMPLOYER]) {
      expect(contentModeration(viewer(role, { universityId: 'u1' }), owner()).comments).toBe(false)
    }
    expect(contentModeration(viewer(Role.PLATFORM_ADMIN, { id: 'stud' }), owner()).content).toBe(
      false,
    )
  })
})
