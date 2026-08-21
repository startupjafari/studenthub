import { describe, expect, it } from 'vitest'
import { Role } from '@studenthub/shared-types'
import { REPOST_AUDIENCES_BY_ROLE, canRepost } from './audiences'
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
