import { Prisma, StoryAudience } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import {
  CreateStorySchema,
  STORY_REACTION_EMOJIS,
  StoryReactionSchema,
} from '@studenthub/shared-schemas'
import { StoriesService, audienceIncludes } from './stories.service'
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
    story: {
      create: jest.fn().mockResolvedValue({ id: 's-new' }),
      count: jest.fn().mockResolvedValue(0),
    },
    storyPoll: { create: jest.fn().mockResolvedValue({ id: 'poll-1' }) },
    // Лок занятости файла (pg_advisory_xact_lock) — порядок вызовов проверяется по нему.
    $executeRaw: jest.fn().mockResolvedValue(0),
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
      update: jest.fn().mockResolvedValue({}),
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
    // Блокировки и скрытые авторы смотрящего: по умолчанию их нет.
    userBlock: { findMany: jest.fn().mockResolvedValue([]) },
    storyMute: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ firstName: 'Аня', lastName: 'Ким' }),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  // Настройки по ключу: бакет сторис и лимиты медиа (по умолчанию env.schema).
  const settings: Record<string, unknown> = {
    MINIO_BUCKET_STORIES: 'stories-media',
    STORY_IMAGE_MAX_MB: 10,
    STORY_VIDEO_MAX_MB: 100,
    STORY_VIDEO_MAX_SECONDS: 60,
  }
  const config = { get: jest.fn((key: string) => settings[key] ?? 'stories-media') }
  const files = {
    getPresignedUrls: jest.fn().mockResolvedValue(new Map([['f-1', 'https://minio/signed']])),
    findOrThrow: jest.fn().mockResolvedValue({
      id: 'f-1',
      ownerId: 'u-1',
      bucket: 'stories-media',
      mime: 'image/jpeg',
      size: 1000,
      durationMs: null,
    }),
    delete: jest.fn().mockResolvedValue(undefined),
  }
  // Описание вариантов — media.service.spec.ts; здесь достаточно пустой карты.
  const media = { describe: jest.fn().mockResolvedValue(new Map()) }
  const queue = { enqueue: jest.fn().mockResolvedValue(true) }
  // Карточки-стикеры: видимость решают модули событий, постов и расписания — здесь заглушки.
  const events = { storySummaries: jest.fn().mockResolvedValue(new Map()) }
  const posts = { storySummaries: jest.fn().mockResolvedValue(new Map()) }
  const schedules = {
    canSharePair: jest.fn().mockResolvedValue(true),
    storyPairSummaries: jest.fn().mockResolvedValue(new Map()),
  }
  const service = new StoriesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    config as unknown as ConfigService<EnvVars, true>,
    files as unknown as FileService,
    media as never,
    queue as never,
    events as never,
    posts as never,
    schedules as never,
  )
  return { service, prisma, tx, audit, files, media, queue, events, posts, schedules }
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

describe('StoriesService — блокировки и скрытые авторы', () => {
  it('сторисы заблокированных в любую сторону не видны: их авторы исключены', async () => {
    const { service, prisma } = setup()
    prisma.userBlock.findMany.mockResolvedValue([
      { blockerId: 's1', blockedId: 'x' },
      { blockerId: 'y', blockedId: 's1' },
    ])
    await service.feed(viewer(Role.STUDENT, { sub: 's1' }), {})
    const where = prisma.story.findMany.mock.calls[0][0].where
    expect(where.AND[1]).toEqual({ authorId: { notIn: ['x', 'y'] } })
  })

  it('сторис заблокировавшего не открывается и по id — NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.userBlock.findMany.mockResolvedValue([{ blockerId: 'author', blockedId: 's1' }])
    prisma.story.findFirst.mockResolvedValue(null)
    const err = await service.getById(viewer(Role.STUDENT, { sub: 's1' }), 'st-1').catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    const where = prisma.story.findFirst.mock.calls[0][0].where
    expect(JSON.stringify(where)).toContain('"notIn":["author"]')
  })

  it('скрытые авторы уходят из ленты, но не из профиля автора', async () => {
    const { service, prisma } = setup()
    prisma.storyMute.findMany.mockResolvedValue([{ mutedUserId: 'm-1' }])
    await service.feed(viewer(Role.STUDENT, { sub: 's1' }), {})
    expect(prisma.story.findMany.mock.calls[0][0].where.AND[1]).toEqual({
      authorId: { notIn: ['m-1'] },
    })
    prisma.storyMute.findMany.mockClear()
    await service.feed(viewer(Role.STUDENT, { sub: 's1' }), { authorId: 'm-1' })
    expect(prisma.storyMute.findMany).not.toHaveBeenCalled()
  })

  it('скрыть свои сторисы нельзя; чужие — идемпотентно', async () => {
    const { service, prisma } = setup()
    const err = await service.mute(viewer(Role.STUDENT, { sub: 's1' }), 's1').catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    prisma.user.findFirst.mockResolvedValue({ id: 'a-1' })
    await service.mute(viewer(Role.STUDENT, { sub: 's1' }), 'a-1')
    expect(prisma.storyMute.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_mutedUserId: { userId: 's1', mutedUserId: 'a-1' } },
        update: {},
      }),
    )
  })

  it('видимость для получателя пересылки берётся из его записи, а не из токена', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue({
      id: 'r-1',
      role: Role.STUDENT,
      universityId: 'uni-2',
      facultyId: null,
      groupId: 'grp-2',
    })
    prisma.story.findFirst.mockResolvedValue(null)
    await expect(service.isVisibleToUser('r-1', 'st-1')).resolves.toBe(false)
    const where = JSON.stringify(prisma.story.findFirst.mock.calls[0][0].where)
    expect(where).toContain('"groupId":"grp-2"')
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

// ── Реакции: белый список ────────────────────────────────────────────────────
describe('StoriesService — реакции из белого списка', () => {
  it('схема принимает только эмодзи из STORY_REACTION_EMOJIS', () => {
    expect(StoryReactionSchema.safeParse({ emoji: '🔥' }).success).toBe(true)
    expect(StoryReactionSchema.safeParse({ emoji: 'a1' }).success).toBe(false)
  })

  it('свои реакции читаются с точным потолком: все варианты на каждую сторис', async () => {
    const { service, prisma } = setup()
    prisma.story.findMany.mockResolvedValue([storyRow({ id: 's1' }), storyRow({ id: 's2' })])
    // Пять своих реакций на одну сторис — все пять приходят как mine.
    prisma.storyReaction.groupBy.mockResolvedValue(
      STORY_REACTION_EMOJIS.map((emoji) => ({ storyId: 's1', emoji, _count: { _all: 1 } })),
    )
    prisma.storyReaction.findMany.mockResolvedValue(
      STORY_REACTION_EMOJIS.map((emoji) => ({ storyId: 's1', emoji })),
    )

    const rings = await service.feed(viewer(Role.STUDENT, { sub: 'me' }), {})
    const card = rings.flatMap((ring) => ring.stories).find((c) => c.id === 's1')

    const args = prisma.storyReaction.findMany.mock.calls[0][0]
    expect(args.take).toBe(2 * STORY_REACTION_EMOJIS.length)
    expect(args.where.emoji).toEqual({ in: [...STORY_REACTION_EMOJIS] })
    expect(card?.reactions.every((r) => r.mine)).toBe(true)
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
    const { service, prisma, tx } = setup()
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'fac-1',
      faculty: { universityId: 'uni-1' },
    })
    tx.story.count.mockResolvedValue(1)
    const err = await service
      .create(
        viewer(Role.STUDENT, { sub: 'u-1', universityId: 'uni-1', groupId: 'grp-1' }),
        { audience: 'GROUP' as const, fileId: 'f-1' },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(tx.story.create).not.toHaveBeenCalled()
  })

  it('занятость файла проверяется под локом файла внутри транзакции вставки (E-F19)', async () => {
    const { service, prisma, tx } = setup()
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'fac-1',
      faculty: { universityId: 'uni-1' },
    })
    prisma.story.findFirst.mockResolvedValue(storyRow())
    await service.create(
      viewer(Role.STUDENT, { sub: 'u-1', universityId: 'uni-1', groupId: 'grp-1' }),
      { audience: 'GROUP' as const, fileId: 'f-1' },
      ctx,
    )
    // Лок → подсчёт → вставка, всё на клиенте транзакции; снаружи занятость не проверяется,
    // иначе два параллельных запроса снова увидели бы «свободен».
    const lockAt = tx.$executeRaw.mock.invocationCallOrder[0] ?? 0
    const countAt = tx.story.count.mock.invocationCallOrder[0] ?? 0
    const createAt = tx.story.create.mock.invocationCallOrder[0] ?? 0
    expect(lockAt).toBeGreaterThan(0)
    expect(lockAt).toBeLessThan(countAt)
    expect(countAt).toBeLessThan(createAt)
    expect(tx.$executeRaw.mock.calls[0]?.slice(1)).toEqual(['story-file:f-1'])
    expect(tx.story.count).toHaveBeenCalledWith({ where: { fileId: 'f-1' } })
    expect(prisma.story.count).not.toHaveBeenCalled()
  })

  it('текстовая сторис без файла лок не берёт', async () => {
    const { service, prisma, tx } = setup()
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'fac-1',
      faculty: { universityId: 'uni-1' },
    })
    prisma.story.findFirst.mockResolvedValue(storyRow())
    await service.create(
      viewer(Role.STUDENT, { sub: 'u-1', universityId: 'uni-1', groupId: 'grp-1' }),
      { audience: 'GROUP' as const, text: 'Привет' },
      ctx,
    )
    expect(tx.$executeRaw).not.toHaveBeenCalled()
    expect(tx.story.create).toHaveBeenCalledTimes(1)
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

  it('у зрителя в списке — его реакции на эту сторис', async () => {
    const { service, prisma } = setup()
    prisma.story.findFirst.mockResolvedValue({ id: 's1', authorId: 'u-1' })
    prisma.storyView.findMany.mockResolvedValue([
      { id: 'v-1', createdAt: new Date(), user: { id: 'w-1' } },
      { id: 'v-2', createdAt: new Date(), user: { id: 'w-2' } },
    ])
    prisma.storyReaction.findMany.mockResolvedValue([
      { userId: 'w-1', emoji: '🔥' },
      { userId: 'w-1', emoji: '❤️' },
    ])
    const res = await service.viewers(viewer(Role.STUDENT, { sub: 'u-1' }), 's1', { limit: 20 })
    expect(res.items[0]).toMatchObject({ reactions: ['🔥', '❤️'] })
    expect(res.items[1]).toMatchObject({ reactions: [] })
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
    author: { role: Role.STUDENT },
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

  it('модератор вуза не снимает сторис админа своего вуза (ранг)', async () => {
    const { service, prisma } = setup()
    prisma.story.findUnique.mockResolvedValue({
      ...story,
      author: { role: Role.UNIVERSITY_ADMIN },
    })
    const err = await service
      .remove(viewer(Role.UNIVERSITY_MODERATOR, { sub: 'm1', universityId: 'uni-1' }), 's1', ctx)
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.story.delete).not.toHaveBeenCalled()
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

describe('StoriesService — редактор: элементы, отметки, медиа', () => {
  const author = viewer(Role.STUDENT, { sub: 'u-1', universityId: 'uni-1', groupId: 'grp-1' })
  const groupStory = { audience: 'GROUP' as const }
  const mention = (userId: string) => ({
    type: 'mention' as const,
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotation: 0,
    userId,
  })
  function groupSetup() {
    const s = setup()
    s.prisma.group.findUnique.mockResolvedValue({
      facultyId: 'fac-1',
      faculty: { universityId: 'uni-1' },
    })
    s.prisma.story.findFirst.mockResolvedValue(storyRow())
    return s
  }

  it('аудитория для одной записи — то же правило, что и выборка', () => {
    const user = {
      id: 'x',
      role: Role.STUDENT,
      universityId: 'uni-1',
      facultyId: 'fac-1',
      groupId: 'grp-1',
    }
    expect(
      audienceIncludes(user, { authorId: 'a', audience: 'GROUP' as never, groupId: 'grp-1' }),
    ).toBe(true)
    expect(
      audienceIncludes(user, { authorId: 'a', audience: 'GROUP' as never, groupId: 'grp-2' }),
    ).toBe(false)
    expect(
      audienceIncludes(user, {
        authorId: 'a',
        audience: 'TEACHERS' as never,
        universityId: 'uni-1',
      }),
    ).toBe(false)
    expect(
      audienceIncludes(
        { ...user, role: Role.TEACHER },
        { authorId: 'a', audience: 'TEACHERS' as never, universityId: 'uni-1' },
      ),
    ).toBe(true)
  })

  it('отметить можно только того, кто увидит сторис: чужая группа — BAD_REQUEST', async () => {
    const { service, prisma, tx } = groupSetup()
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'm-1',
        role: Role.STUDENT,
        universityId: 'uni-1',
        facultyId: 'fac-1',
        groupId: 'grp-2',
      },
    ])
    const err = await service
      .create(author, { ...groupStory, text: 'x', elements: [mention('m-1')] }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(tx.story.create).not.toHaveBeenCalled()
  })

  it('блокировка с отмеченным в любую сторону — BAD_REQUEST', async () => {
    const { service, prisma, tx } = groupSetup()
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'm-1',
        role: Role.STUDENT,
        universityId: 'uni-1',
        facultyId: 'fac-1',
        groupId: 'grp-1',
      },
    ])
    prisma.userBlock.findMany.mockResolvedValue([{ id: 'b-1' }])
    const err = await service
      .create(author, { ...groupStory, text: 'x', elements: [mention('m-1')] }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(tx.story.create).not.toHaveBeenCalled()
  })

  it('элементы сохраняются, отмеченным уходит уведомление (себя — нет)', async () => {
    const { service, prisma, tx, queue } = groupSetup()
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'm-1',
        role: Role.STUDENT,
        universityId: 'uni-1',
        facultyId: 'fac-1',
        groupId: 'grp-1',
      },
    ])
    const elements = [mention('m-1'), mention('u-1'), mention('m-1')]
    await service.create(author, { ...groupStory, elements }, ctx)
    expect(tx.story.create.mock.calls[0][0].data.elements).toEqual(elements)
    expect(queue.enqueue).toHaveBeenCalledWith(
      'notifications',
      'story-mention',
      expect.objectContaining({ recipientIds: ['m-1'], type: 'POST' }),
      expect.anything(),
    )
  })

  it('медиа: формат вне списка, размер и длительность сверх лимита — BAD_REQUEST', async () => {
    const { service, files } = groupSetup()
    const tryFile = async (file: Record<string, unknown>) => {
      files.findOrThrow.mockResolvedValue({
        id: 'f-1',
        ownerId: 'u-1',
        bucket: 'stories-media',
        ...file,
      })
      return service.create(author, { ...groupStory, fileId: 'f-1' }, ctx).catch((e) => e)
    }
    expect((await tryFile({ mime: 'image/gif', size: 10, durationMs: null })).code).toBe(
      'BAD_REQUEST',
    )
    expect(
      (await tryFile({ mime: 'image/png', size: 11 * 1024 * 1024, durationMs: null })).code,
    ).toBe('BAD_REQUEST')
    expect((await tryFile({ mime: 'video/mp4', size: 10, durationMs: 61_000 })).code).toBe(
      'BAD_REQUEST',
    )
  })

  it('в выдаче у отметки — имя; удалённый или скрытый блокировкой — не рисуется', async () => {
    const { service, prisma } = setup()
    prisma.story.findFirst.mockResolvedValue(
      storyRow({ elements: [mention('m-1'), mention('gone'), { type: 'bogus' }] }),
    )
    prisma.user.findMany.mockResolvedValue([{ id: 'm-1', firstName: 'Аня', lastName: 'Ким' }])
    const card = await service.getById(viewer(Role.STUDENT, { sub: 's-1' }), 's1')
    expect(card.elements).toEqual([{ ...mention('m-1'), name: 'Аня Ким' }])
  })

  it('схема: не больше 10 разных отметок, позиция — доля кадра', () => {
    const many = Array.from({ length: 11 }, (_, i) => mention(`m-${i}`))
    expect(
      CreateStorySchema.safeParse({ audience: 'ALL', text: 'x', elements: many }).success,
    ).toBe(false)
    expect(
      CreateStorySchema.safeParse({ audience: 'ALL', elements: [{ ...mention('m'), x: 1.5 }] })
        .success,
    ).toBe(false)
    expect(CreateStorySchema.safeParse({ audience: 'ALL', elements: [mention('m')] }).success).toBe(
      true,
    )
  })
})

describe('StoriesService — карточки событий, постов и пар (§3.4)', () => {
  const author = viewer(Role.STUDENT, { sub: 'u-1', universityId: 'uni-1', groupId: 'grp-1' })
  const place = { x: 0.5, y: 0.5, scale: 1, rotation: 0 }
  function groupSetup() {
    const s = setup()
    s.prisma.group.findUnique.mockResolvedValue({
      facultyId: 'fac-1',
      faculty: { universityId: 'uni-1' },
    })
    s.prisma.story.findFirst.mockResolvedValue(storyRow())
    return s
  }

  it('событие, которого автор не видит, — BAD_REQUEST, сторис не создаётся', async () => {
    const { service, tx } = groupSetup()
    const err = await service
      .create(
        author,
        { audience: 'GROUP' as const, elements: [{ type: 'event', ...place, eventId: 'e-1' }] },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(tx.story.create).not.toHaveBeenCalled()
  })

  it('чужая пара — BAD_REQUEST', async () => {
    const { service, schedules, tx } = groupSetup()
    schedules.canSharePair.mockResolvedValue(false)
    const err = await service
      .create(
        author,
        {
          audience: 'GROUP' as const,
          elements: [{ type: 'schedule', ...place, pairId: 'p-1', date: '2026-11-02' }],
        },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(schedules.canSharePair).toHaveBeenCalledWith(author, 'p-1')
    expect(tx.story.create).not.toHaveBeenCalled()
  })

  it('видимые событие и пост проходят', async () => {
    const { service, events, posts, tx } = groupSetup()
    events.storySummaries.mockResolvedValue(new Map([['e-1', { id: 'e-1' }]]))
    posts.storySummaries.mockResolvedValue(new Map([['p-1', { id: 'p-1' }]]))
    await service.create(
      author,
      {
        audience: 'GROUP' as const,
        elements: [
          { type: 'event', ...place, eventId: 'e-1' },
          { type: 'post', ...place, postId: 'p-1' },
        ],
      },
      ctx,
    )
    expect(tx.story.create).toHaveBeenCalled()
    expect(events.storySummaries).toHaveBeenCalledWith(author, ['e-1'])
  })

  it('в выдаче карточка — по правам зрителя: невидимое событие приходит как null', async () => {
    const { service, prisma, events } = setup()
    prisma.story.findFirst.mockResolvedValue(
      storyRow({
        elements: [
          { type: 'event', ...place, eventId: 'e-1' },
          { type: 'event', ...place, eventId: 'e-2' },
        ],
      }),
    )
    const card = { id: 'e-1', title: 'Хакатон' }
    events.storySummaries.mockResolvedValue(new Map([['e-1', card]]))
    const s = await service.getById(viewer(Role.STUDENT, { sub: 'v-1' }), 's1')
    expect(s.elements).toEqual([
      { type: 'event', ...place, eventId: 'e-1', event: card },
      { type: 'event', ...place, eventId: 'e-2', event: null },
    ])
  })

  it('два первых голоса одновременно: второй заменяет первый, а не падает', async () => {
    const { service, prisma } = setup()
    prisma.story.findFirst.mockResolvedValueOnce({
      id: 's1',
      poll: { id: 'poll-1', options: [{ id: 'o-1' }, { id: 'o-2' }] },
    })
    prisma.story.findFirst.mockResolvedValue(storyRow())
    prisma.storyPollVote.upsert.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
    )
    await service.vote(viewer(Role.STUDENT, { sub: 'v-1' }), 's1', { optionId: 'o-2' })
    expect(prisma.storyPollVote.update).toHaveBeenCalledWith({
      where: { pollId_userId: { pollId: 'poll-1', userId: 'v-1' } },
      data: { optionId: 'o-2' },
    })
  })
})
