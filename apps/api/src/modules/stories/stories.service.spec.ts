import { StoryAudience } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { StoriesService } from './stories.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { ConfigService } from '@nestjs/config'
import type { FileService } from '../files/file.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import { AppException } from '../../common/exceptions/app.exception'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

function setup() {
  // Создание идёт транзакцией: сторис и её опрос появляются вместе или не появляются вовсе.
  const tx = {
    story: { create: jest.fn().mockResolvedValue({ id: 's-new' }) },
    storyPoll: { create: jest.fn().mockResolvedValue({ id: 'poll-1' }) },
  }
  const prisma = {
    story: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    storyPollVote: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
    storyView: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
    storyReaction: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({}),
    },
    faculty: { findUnique: jest.fn() },
    group: { findUnique: jest.fn() },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const config = { get: jest.fn().mockReturnValue('stories-media') }
  const files = {
    getPresignedUrls: jest.fn().mockResolvedValue(new Map([['f-1', 'https://minio/signed']])),
    findOrThrow: jest
      .fn()
      .mockResolvedValue({ id: 'f-1', ownerId: 'u-1', bucket: 'stories-media' }),
    delete: jest.fn().mockResolvedValue(undefined),
  }
  const service = new StoriesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    config as unknown as ConfigService<EnvVars, true>,
    files as unknown as FileService,
  )
  return { service, prisma, tx, audit, files }
}

function viewer(role: Role, scope: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: scope.sub ?? 'u-1',
    role,
    universityId: scope.universityId ?? null,
    facultyId: scope.facultyId ?? null,
    groupId: scope.groupId ?? null,
  }
}

// Есть ли в OR запись с данной audience и (опц.) полем скоупа.
function hasClause(
  where: { OR?: Array<Record<string, unknown>> },
  match: Record<string, unknown>,
): boolean {
  return (where.OR ?? []).some((c) => Object.entries(match).every(([k, v]) => c[k] === v))
}

function storyRow(over: Record<string, unknown> = {}) {
  return {
    id: 's-new',
    authorId: 'u-1',
    audience: StoryAudience.GROUP,
    universityId: 'uni-1',
    facultyId: 'fac-1',
    groupId: 'grp-1',
    text: 'привет',
    background: null,
    linkUrl: null,
    linkLabel: null,
    expiresAt: new Date(Date.now() + 3600_000),
    createdAt: new Date(),
    author: { id: 'u-1', firstName: 'A', lastName: 'B', role: Role.STUDENT, avatarUrl: null },
    file: null,
    poll: null,
    ...over,
  }
}

// ── Видимость ────────────────────────────────────────────────────────────────
describe('StoriesService.feed — видимость', () => {
  async function feedWhere(v: JwtPayload) {
    const { service, prisma } = setup()
    await service.feed(v, {})
    return prisma.story.findMany.mock.calls[0][0].where
  }

  it('студент видит ALL, свои, вуз, факультет и группу — и только живые', async () => {
    const where = await feedWhere(
      viewer(Role.STUDENT, {
        sub: 's1',
        universityId: 'uni-1',
        facultyId: 'fac-1',
        groupId: 'grp-1',
      }),
    )
    expect(where.expiresAt.gt).toBeInstanceOf(Date)
    expect(hasClause(where, { audience: 'ALL' })).toBe(true)
    expect(hasClause(where, { authorId: 's1' })).toBe(true)
    expect(hasClause(where, { audience: 'UNIVERSITY', universityId: 'uni-1' })).toBe(true)
    expect(hasClause(where, { audience: 'FACULTY', facultyId: 'fac-1' })).toBe(true)
    expect(hasClause(where, { audience: 'GROUP', groupId: 'grp-1' })).toBe(true)
    // Аудитория преподавателей студенту не видна.
    expect(hasClause(where, { audience: 'TEACHERS', universityId: 'uni-1' })).toBe(false)
  })

  it('преподаватель дополнительно видит аудиторию TEACHERS своего вуза', async () => {
    const where = await feedWhere(viewer(Role.TEACHER, { sub: 't1', universityId: 'uni-1' }))
    expect(hasClause(where, { audience: 'TEACHERS', universityId: 'uni-1' })).toBe(true)
  })

  it('фильтр по автору пересекается с видимостью, а не заменяет её', async () => {
    const { service, prisma } = setup()
    await service.feed(viewer(Role.STUDENT, { sub: 's1', groupId: 'grp-1' }), { authorId: 'u-9' })
    const where = prisma.story.findMany.mock.calls[0][0].where
    expect(where.AND[0]).toEqual({ authorId: 'u-9' })
    expect(where.AND[1].OR).toBeDefined()
  })

  it('выборка ограничена потолком и отдаёт свежие первыми', async () => {
    const { service, prisma } = setup()
    await service.feed(viewer(Role.STUDENT, { sub: 's1' }), {})
    const args = prisma.story.findMany.mock.calls[0][0]
    expect(args.take).toBe(200)
    expect(args.orderBy[0]).toEqual({ createdAt: 'desc' })
  })
})

// ── Кольца ───────────────────────────────────────────────────────────────────
describe('StoriesService.feed — кольца авторов', () => {
  it('свои идут первыми, непросмотренные выше просмотренных, внутри — по возрастанию', async () => {
    const { service, prisma } = setup()
    const me = { id: 'me', firstName: 'M', lastName: 'E', role: Role.STUDENT, avatarUrl: null }
    const other = { id: 'o1', firstName: 'O', lastName: 'Ne', role: Role.STUDENT, avatarUrl: null }
    const seen = { id: 'o2', firstName: 'S', lastName: 'Een', role: Role.STUDENT, avatarUrl: null }
    prisma.story.findMany.mockResolvedValue([
      storyRow({ id: 's3', authorId: 'o2', author: seen, createdAt: new Date(3000) }),
      storyRow({ id: 's2', authorId: 'o1', author: other, createdAt: new Date(2000) }),
      storyRow({ id: 's1b', authorId: 'me', author: me, createdAt: new Date(1500) }),
      storyRow({ id: 's1a', authorId: 'me', author: me, createdAt: new Date(1000) }),
    ])
    // Зритель уже смотрел сторис o2 — её кольцо уходит вниз.
    prisma.storyView.findMany.mockResolvedValue([{ storyId: 's3' }])

    const rings = await service.feed(viewer(Role.STUDENT, { sub: 'me' }), {})

    expect(rings.map((r) => r.author.id)).toEqual(['me', 'o1', 'o2'])
    expect(rings.map((r) => r.stories.map((s) => s.id))).toEqual([['s1a', 's1b'], ['s2'], ['s3']])
    expect(rings.map((r) => r.hasUnseen)).toEqual([true, true, false])
  })

  it('число просмотров видно автору и скрыто от остальных', async () => {
    const { service, prisma } = setup()
    prisma.story.findMany.mockResolvedValue([
      storyRow({ id: 'mine', authorId: 'me' }),
      storyRow({ id: 'alien', authorId: 'other' }),
    ])
    prisma.storyView.groupBy.mockResolvedValue([{ storyId: 'mine', _count: { _all: 7 } }])

    const rings = await service.feed(viewer(Role.STUDENT, { sub: 'me' }), {})
    const cards = rings.flatMap((ring) => ring.stories)

    expect(cards.find((c) => c.id === 'mine')?.viewsCount).toBe(7)
    expect(cards.find((c) => c.id === 'alien')?.viewsCount).toBeNull()
    // Чужие сторисы в агрегат просмотров не попадают вовсе.
    expect(prisma.storyView.groupBy.mock.calls[0][0].where.storyId.in).toEqual(['mine'])
  })
})

// ── Создание ─────────────────────────────────────────────────────────────────
describe('StoriesService.create', () => {
  it('студент не может опубликовать на весь вуз', async () => {
    const { service } = setup()
    const err = await service
      .create(
        viewer(Role.STUDENT, { sub: 's1', universityId: 'uni-1', groupId: 'grp-1' }),
        { audience: 'UNIVERSITY' as const, text: 'x' },
        ctx,
      )
      .catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('чужая группа — WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'fac-2',
      faculty: { universityId: 'uni-1' },
    })
    const err = await service
      .create(
        viewer(Role.STUDENT, { sub: 's1', universityId: 'uni-1', groupId: 'grp-1' }),
        { audience: 'GROUP' as const, groupId: 'grp-9', text: 'x' },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
  })

  it('своя группа: scope проставляется из иерархии, срок жизни — сутки', async () => {
    const { service, prisma, tx } = setup()
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'fac-1',
      faculty: { universityId: 'uni-1' },
    })
    prisma.story.findFirst.mockResolvedValue(storyRow())

    await service.create(
      viewer(Role.STUDENT, { sub: 'u-1', universityId: 'uni-1', groupId: 'grp-1' }),
      { audience: 'GROUP' as const, text: 'привет' },
      ctx,
    )

    const data = tx.story.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      authorId: 'u-1',
      audience: 'GROUP',
      groupId: 'grp-1',
      facultyId: 'fac-1',
      universityId: 'uni-1',
    })
    const ttlMs = data.expiresAt.getTime() - Date.now()
    expect(ttlMs).toBeGreaterThan(23 * 3600_000)
    expect(ttlMs).toBeLessThanOrEqual(24 * 3600_000)
  })

  it('опрос создаётся в той же транзакции, варианты нумеруются по порядку', async () => {
    const { service, prisma, tx } = setup()
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'fac-1',
      faculty: { universityId: 'uni-1' },
    })
    prisma.story.findFirst.mockResolvedValue(storyRow())

    await service.create(
      viewer(Role.STAROSTA, { sub: 'u-1', universityId: 'uni-1', groupId: 'grp-1' }),
      {
        audience: 'GROUP' as const,
        text: 'x',
        poll: { question: 'Идём?', options: ['Да', 'Нет'] },
      },
      ctx,
    )

    expect(prisma.$transaction).toHaveBeenCalled()
    expect(tx.storyPoll.create.mock.calls[0][0].data.options.create).toEqual([
      { text: 'Да', order: 0 },
      { text: 'Нет', order: 1 },
    ])
  })

  it('чужой файл прикрепить нельзя', async () => {
    const { service, prisma, tx, files } = setup()
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'fac-1',
      faculty: { universityId: 'uni-1' },
    })
    files.findOrThrow.mockResolvedValue({
      id: 'f-1',
      ownerId: 'someone-else',
      bucket: 'stories-media',
    })
    const err = await service
      .create(
        viewer(Role.STUDENT, { sub: 'u-1', universityId: 'uni-1', groupId: 'grp-1' }),
        { audience: 'GROUP' as const, fileId: 'f-1' },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(tx.story.create).not.toHaveBeenCalled()
  })

  it('файл, уже занятый другой сторис, — CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'fac-1',
      faculty: { universityId: 'uni-1' },
    })
    prisma.story.count.mockResolvedValue(1)
    const err = await service
      .create(
        viewer(Role.STUDENT, { sub: 'u-1', universityId: 'uni-1', groupId: 'grp-1' }),
        { audience: 'GROUP' as const, fileId: 'f-1' },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('CONFLICT')
  })
})

// ── Просмотры, реакции, голос ────────────────────────────────────────────────
describe('StoriesService — просмотр и голос', () => {
  it('свой просмотр не записывается', async () => {
    const { service, prisma } = setup()
    prisma.story.findFirst.mockResolvedValue({ id: 's1', authorId: 'u-1' })
    await service.markViewed(viewer(Role.STUDENT, { sub: 'u-1' }), 's1')
    expect(prisma.storyView.upsert).not.toHaveBeenCalled()
  })

  it('чужой просмотр пишется идемпотентно (upsert без обновления)', async () => {
    const { service, prisma } = setup()
    prisma.story.findFirst.mockResolvedValue({ id: 's1', authorId: 'author' })
    await service.markViewed(viewer(Role.STUDENT, { sub: 'viewer-1' }), 's1')
    const args = prisma.storyView.upsert.mock.calls[0][0]
    expect(args.update).toEqual({})
    expect(args.create).toEqual({ storyId: 's1', userId: 'viewer-1' })
  })

  it('голос в сторис без опроса — BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.story.findFirst.mockResolvedValue({ id: 's1', poll: null })
    const err = await service
      .vote(viewer(Role.STUDENT, { sub: 'v1' }), 's1', { optionId: 'o1' })
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
  })

  it('вариант из чужого опроса не принимается', async () => {
    const { service, prisma } = setup()
    prisma.story.findFirst.mockResolvedValue({
      id: 's1',
      poll: { id: 'p1', options: [{ id: 'o1' }] },
    })
    const err = await service
      .vote(viewer(Role.STUDENT, { sub: 'v1' }), 's1', { optionId: 'чужой' })
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(prisma.storyPollVote.upsert).not.toHaveBeenCalled()
  })

  it('повторный голос перезаписывает прежний', async () => {
    const { service, prisma } = setup()
    prisma.story.findFirst.mockResolvedValue({
      id: 's1',
      poll: { id: 'p1', options: [{ id: 'o1' }, { id: 'o2' }] },
    })
    // getById после голоса читает сторис целиком.
    prisma.story.findFirst.mockResolvedValueOnce({
      id: 's1',
      poll: { id: 'p1', options: [{ id: 'o1' }, { id: 'o2' }] },
    })
    prisma.story.findFirst.mockResolvedValueOnce(storyRow())
    await service.vote(viewer(Role.STUDENT, { sub: 'v1' }), 's1', { optionId: 'o2' })
    const args = prisma.storyPollVote.upsert.mock.calls[0][0]
    expect(args.where).toEqual({ pollId_userId: { pollId: 'p1', userId: 'v1' } })
    expect(args.update).toEqual({ optionId: 'o2' })
  })
})

// ── Зрители ──────────────────────────────────────────────────────────────────
describe('StoriesService.viewers', () => {
  it('список зрителей чужой сторис не отдаётся', async () => {
    const { service, prisma } = setup()
    prisma.story.findFirst.mockResolvedValue({ id: 's1', authorId: 'author' })
    const err = await service
      .viewers(viewer(Role.STUDENT, { sub: 'not-author' }), 's1', { limit: 20 })
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('автору отдаётся страница с запасом на признак hasNext', async () => {
    const { service, prisma } = setup()
    prisma.story.findFirst.mockResolvedValue({ id: 's1', authorId: 'u-1' })
    prisma.storyView.findMany.mockResolvedValue([])
    await service.viewers(viewer(Role.STUDENT, { sub: 'u-1' }), 's1', { limit: 20, cursor: 'v-10' })
    const args = prisma.storyView.findMany.mock.calls[0][0]
    expect(args.take).toBe(21)
    expect(args.cursor).toEqual({ id: 'v-10' })
    expect(args.skip).toBe(1)
  })
})

// ── Удаление ─────────────────────────────────────────────────────────────────
describe('StoriesService.remove', () => {
  const story = {
    id: 's1',
    authorId: 'author',
    fileId: 'f-1',
    universityId: 'uni-1',
    facultyId: 'fac-1',
  }

  it('чужую сторис студент удалить не может', async () => {
    const { service, prisma } = setup()
    prisma.story.findUnique.mockResolvedValue(story)
    const err = await service
      .remove(viewer(Role.STUDENT, { sub: 'someone' }), 's1', ctx)
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.story.delete).not.toHaveBeenCalled()
  })

  it('декан чужого факультета — WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.story.findUnique.mockResolvedValue(story)
    const err = await service
      .remove(
        viewer(Role.DEAN, { sub: 'd1', universityId: 'uni-1', facultyId: 'fac-9' }),
        's1',
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
  })

  it('автор удаляет сторис вместе с медиа и записью в журнале', async () => {
    const { service, prisma, files, audit } = setup()
    prisma.story.findUnique.mockResolvedValue(story)
    await service.remove(viewer(Role.STUDENT, { sub: 'author' }), 's1', ctx)
    expect(prisma.story.delete).toHaveBeenCalledWith({ where: { id: 's1' } })
    expect(files.delete).toHaveBeenCalledWith('f-1')
    expect(audit.record.mock.calls[0][0]).toMatchObject({ action: 'story_deleted' })
  })

  it('декан своего факультета удаляет чужую сторис', async () => {
    const { service, prisma } = setup()
    prisma.story.findUnique.mockResolvedValue(story)
    await service.remove(
      viewer(Role.DEAN, { sub: 'd1', universityId: 'uni-1', facultyId: 'fac-1' }),
      's1',
      ctx,
    )
    expect(prisma.story.delete).toHaveBeenCalled()
  })
})

// ── Крон ─────────────────────────────────────────────────────────────────────
describe('StoriesService.deleteExpired', () => {
  it('удаляет истёкшие батчем и сносит их медиа', async () => {
    const { service, prisma, files } = setup()
    prisma.story.findMany
      .mockResolvedValueOnce([
        { id: 's1', fileId: 'f-1' },
        { id: 's2', fileId: null },
      ])
      .mockResolvedValueOnce([])
    prisma.story.deleteMany.mockResolvedValue({ count: 2 })

    const removed = await service.deleteExpired()

    expect(removed).toBe(2)
    expect(prisma.story.findMany.mock.calls[0][0].where.expiresAt.lte).toBeInstanceOf(Date)
    expect(prisma.story.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['s1', 's2'] } } })
    expect(files.delete).toHaveBeenCalledTimes(1)
  })

  it('сбой удаления медиа не отменяет удаление сторис', async () => {
    const { service, prisma, files } = setup()
    prisma.story.findMany
      .mockResolvedValueOnce([{ id: 's1', fileId: 'f-1' }])
      .mockResolvedValueOnce([])
    prisma.story.deleteMany.mockResolvedValue({ count: 1 })
    files.delete.mockRejectedValue(new Error('minio down'))

    await expect(service.deleteExpired()).resolves.toBe(1)
  })
})
