import { describe, expect, it } from 'vitest'
import { Role } from '@studenthub/shared-types'
import { REPOST_AUDIENCES_BY_ROLE, canRepost, selfRepostAudience } from './audiences'
import type { FeedPost } from './types'

const post = (o: Partial<Pick<FeedPost, 'audience' | 'status'>> = {}) => ({
  audience: 'GROUP' as const,
  status: 'PUBLISHED',
  ...o,
})

describe('REPOST_AUDIENCES_BY_ROLE', () => {
  it('у преподавателя нет аудитории SUBJECT — в RepostSchema нет поля subject', () => {
    expect(REPOST_AUDIENCES_BY_ROLE[Role.TEACHER]).toEqual(['GROUP', 'PERSONAL'])
  })

  it('модераторы не публикуют — аудиторий нет', () => {
    expect(REPOST_AUDIENCES_BY_ROLE[Role.PLATFORM_MODERATOR] ?? []).toEqual([])
    expect(REPOST_AUDIENCES_BY_ROLE[Role.UNIVERSITY_MODERATOR] ?? []).toEqual([])
  })
})

describe('canRepost', () => {
  it('автор публикаций репостит опубликованный пост', () => {
    expect(canRepost(Role.STUDENT, post())).toBe(true)
    expect(canRepost(Role.DEAN, post())).toBe(true)
  })

  it('модератор постов не создаёт — репост недоступен', () => {
    expect(canRepost(Role.UNIVERSITY_MODERATOR, post())).toBe(false)
  })

  it('роль не восстановлена (null) — репост недоступен', () => {
    expect(canRepost(null, post())).toBe(false)
  })

  it('личный пост не репостится — он адресован одному человеку', () => {
    expect(canRepost(Role.STUDENT, post({ audience: 'PERSONAL' }))).toBe(false)
  })

  it('черновик и отложенный не репостятся — они ещё не опубликованы', () => {
    expect(canRepost(Role.STUDENT, post({ status: 'DRAFT' }))).toBe(false)
    expect(canRepost(Role.STUDENT, post({ status: 'SCHEDULED' }))).toBe(false)
  })
})

describe('selfRepostAudience', () => {
  // Скоупы как в БД: у студента и старосты есть группа, у декана и преподавателя —
  // только факультет, у админа университета — только университет.
  const student = { groupId: 'g1', facultyId: 'f1', universityId: 'un1' }
  const staff = { groupId: null, facultyId: 'f1', universityId: 'un1' }
  const admin = { groupId: null, facultyId: null, universityId: 'un1' }

  it('студент и староста репостят в свою группу', () => {
    expect(selfRepostAudience(Role.STUDENT, student)).toBe('GROUP')
    expect(selfRepostAudience(Role.STAROSTA, student)).toBe('GROUP')
  })

  it('декан — на свой факультет: группу он не выбирает, а своей у него нет', () => {
    expect(selfRepostAudience(Role.DEAN, staff)).toBe('FACULTY')
  })

  it('админ университета — на весь университет', () => {
    expect(selfRepostAudience(Role.UNIVERSITY_ADMIN, admin)).toBe('UNIVERSITY')
  })

  it('админ платформы — «все»', () => {
    expect(selfRepostAudience(Role.PLATFORM_ADMIN, { universityId: null })).toBe('ALL')
  })

  it('преподаватель — null: группу он выбирает руками, своей в профиле нет', () => {
    expect(selfRepostAudience(Role.TEACHER, staff)).toBeNull()
  })

  it('роль не восстановлена или не публикует — null', () => {
    expect(selfRepostAudience(null, student)).toBeNull()
    expect(selfRepostAudience(Role.UNIVERSITY_MODERATOR, student)).toBeNull()
  })

  it('группы в профиле нет — аудитория не выбирается вслепую', () => {
    expect(selfRepostAudience(Role.STUDENT, { groupId: null })).toBeNull()
  })
})
