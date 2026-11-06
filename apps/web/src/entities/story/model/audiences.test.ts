import { describe, expect, it } from 'vitest'
import { Role } from '@studenthub/shared-types'
import { STORY_AUDIENCES_BY_ROLE, canCreateStory } from './audiences'

// Зеркало ALLOWED_AUDIENCES из apps/api/src/modules/stories/stories.service.ts (§3.4).
describe('аудитории сторис по роли', () => {
  it('публикуют все роли с социальными разделами, кроме охраны и библиотекаря', () => {
    for (const role of Object.values(Role)) {
      const restricted = role === Role.SECURITY_GUARD || role === Role.LIBRARIAN
      expect(canCreateStory(role), role).toBe(!restricted)
    }
    expect(canCreateStory(null)).toBe(false)
  })

  it('модераторы: платформа — на всех, вуз — на свой вуз, оба ещё личным кругом', () => {
    expect(STORY_AUDIENCES_BY_ROLE[Role.PLATFORM_MODERATOR]).toEqual(['ALL', 'FRIENDS', 'SELECTED'])
    expect(STORY_AUDIENCES_BY_ROLE[Role.UNIVERSITY_MODERATOR]).toEqual([
      'UNIVERSITY',
      'FRIENDS',
      'SELECTED',
    ])
  })

  it('работодатель — только студентам вузов-партнёров, без личных аудиторий', () => {
    expect(STORY_AUDIENCES_BY_ROLE[Role.EMPLOYER]).toEqual(['PARTNER_UNIVERSITIES'])
  })
})
