import { PostAudience } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { PostsService } from './posts.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { ConfigService } from '@nestjs/config'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import { AppException } from '../../common/exceptions/app.exception'
import { POST_REACTION_EMOJIS, ReactionSchema } from '@studenthub/shared-schemas'
import { MEDIA_FILE_SELECT } from '../media/media.types'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

function setup() {
  const prisma = {
    post: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'p-new' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    reaction: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({}),
      // Сводка реакций выдачи: счётчики groupBy + свои реакции зрителя (decorate).
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    postBookmark: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    comment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      // Счётчик комментариев ленты: отдельный groupBy по id страницы (decorateFeed).
      groupBy: jest.fn().mockResolvedValue([]),
    },
    faculty: { findUnique: jest.fn() },
    group: { findUnique: jest.fn() },
    user: { findFirst: jest.fn() },
    file: { findMany: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn() },
    // Создание поста с медиа — интерактивная транзакция; в тесте она идёт на тех же моках.
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) =>
    fn(prisma),
  )
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const config = { get: jest.fn().mockReturnValue('posts-media') }
  const files = {
    getPresignedUrl: jest.fn().mockResolvedValue('https://minio/signed'),
    // Пачка ссылок на медиа выдачи: по ссылке на каждый переданный id.
    getPresignedUrls: jest.fn(
      async (ids: string[]) => new Map(ids.map((id) => [id, `https://minio/${id}`])),
    ),
  }
  const media = {
    describeOne: jest.fn().mockResolvedValue({ status: 'READY', sources: [] }),
    describe: jest.fn(
      async (list: Array<{ id: string }>) => new Map(list.map((f) => [f.id, describedMedia(f.id)])),
    ),
  }
  const service = new PostsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    config as unknown as ConfigService<EnvVars, true>,
    files as unknown as import('../files/file.service').FileService,
    media as never,
  )
  return { service, prisma, audit, files, media }
}

function describedMedia(id: string) {
  return {
    status: 'READY',
    placeholder: 'data:image/webp;base64,xx',
    width: 1200,
    height: 800,
    durationMs: null,
    sources: [{ width: 640, height: 427, url: `https://minio/${id}-640` }],
    poster: [],
    hls: null,
    expiresAt: '2026-10-17T10:15:00.000Z',
  }
}

// Строка медиа поста так, как её отдаёт выборка (MEDIA_FILE_SELECT): с бакетом и вариантами.
function mediaRow(id: string) {
  return {
    id,
    bucket: 'posts-media',
    mime: 'image/jpeg',
    width: 1200,
    height: 800,
    mediaStatus: 'READY',
    placeholder: 'data:image/webp;base64,xx',
    durationMs: null,
    variants: [
      {
        kind: 'IMAGE',
        width: 640,
        height: 427,
        key: `v/${id}/640.webp`,
        mime: 'image/webp',
        bitrate: null,
      },
    ],
  }
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

function postRow(over: Record<string, unknown> = {}) {
  return {
    id: 'p-new',
    audience: PostAudience.GROUP,
    content: 'x',
    authorId: 'u-1',
    universityId: 'uni-1',
    facultyId: 'fac-1',
    groupId: 'grp-1',
    targetUserId: null,
    subject: null,
    priority: 30,
    pinnedAt: null,
    originalPostId: null,
    createdAt: new Date(),
    author: { id: 'u-1', firstName: 'A', lastName: 'B', role: Role.STUDENT, avatarUrl: null },
    media: [],
    reactions: [],
    original: null,
    _count: { comments: 0 },
    ...over,
  }
}

// ── 8.2 Матрица видимости ────────────────────────────────────────────────────
describe('PostsService.feed — видимость (8.2)', () => {
  async function feedWhere(v: JwtPayload) {
    const { service, prisma } = setup()
    await service.feed(v, { limit: 20 })
    return prisma.post.findMany.mock.calls[0][0].where
  }

  it('студент видит ALL, свои, PERSONAL себе, вуз/факультет/группу', async () => {
    const where = await feedWhere(
      viewer(Role.STUDENT, {
        sub: 's1',
        universityId: 'uni-1',
        facultyId: 'fac-1',
        groupId: 'grp-1',
      }),
    )
    expect(where.deletedAt).toBeNull()
    expect(hasClause(where, { audience: 'ALL' })).toBe(true)
    expect(hasClause(where, { authorId: 's1' })).toBe(true)
    expect(hasClause(where, { audience: 'PERSONAL', targetUserId: 's1' })).toBe(true)
    expect(hasClause(where, { audience: 'UNIVERSITY', universityId: 'uni-1' })).toBe(true)
    expect(hasClause(where, { audience: 'FACULTY', facultyId: 'fac-1' })).toBe(true)
    expect(hasClause(where, { audience: 'GROUP', groupId: 'grp-1' })).toBe(true)
    // Студент НЕ видит посты для преподавателей.
    expect(hasClause(where, { audience: 'TEACHERS', universityId: 'uni-1' })).toBe(false)
  })

  it('преподаватель дополнительно видит TEACHERS своего вуза', async () => {
    const where = await feedWhere(viewer(Role.TEACHER, { universityId: 'uni-1' }))
    expect(hasClause(where, { audience: 'TEACHERS', universityId: 'uni-1' })).toBe(true)
  })

  it('без группы/факультета соответствующие ветки отсутствуют', async () => {
    const where = await feedWhere(viewer(Role.PLATFORM_ADMIN, {}))
    expect(hasClause(where, { audience: 'GROUP' })).toBe(false)
    expect(hasClause(where, { audience: 'FACULTY' })).toBe(false)
    expect(hasClause(where, { audience: 'ALL' })).toBe(true)
  })
})

// ── 8.3 Cursor-пагинация ────────────────────────────────────────────────────
describe('PostsService.feed — cursor (8.3)', () => {
  it('возвращает limit элементов и next cursor при наличии следующей страницы', async () => {
    const { service, prisma } = setup()
    const rows = Array.from({ length: 21 }, (_, i) => postRow({ id: `p${i}` }))
    prisma.post.findMany.mockResolvedValue(rows)
    const res = await service.feed(viewer(Role.STUDENT, { groupId: 'grp-1' }), { limit: 20 })
    expect(res.items).toHaveLength(20)
    expect(res.meta.hasNext).toBe(true)
    expect(res.meta.cursor).toBe('p19')
    // take = limit + 1 для определения hasNext.
    expect(prisma.post.findMany.mock.calls[0][0].take).toBe(21)
  })

  it('cursor прокидывается в запрос со skip:1', async () => {
    const { service, prisma } = setup()
    prisma.post.findMany.mockResolvedValue([])
    await service.feed(viewer(Role.STUDENT, { groupId: 'grp-1' }), { limit: 20, cursor: 'p10' })
    const arg = prisma.post.findMany.mock.calls[0][0]
    expect(arg.cursor).toEqual({ id: 'p10' })
    expect(arg.skip).toBe(1)
  })

  it('последняя страница — hasNext=false, cursor undefined', async () => {
    const { service, prisma } = setup()
    prisma.post.findMany.mockResolvedValue([postRow({ id: 'p0' })])
    const res = await service.feed(viewer(Role.STUDENT, { groupId: 'grp-1' }), { limit: 20 })
    expect(res.meta.hasNext).toBe(false)
    expect(res.meta.cursor).toBeUndefined()
  })
})

// ── 8.2 Создание: аудитория ограничена ролью + scope ────────────────────────
describe('PostsService.create — аудитория по роли (8.2)', () => {
  it('студент → GROUP своей группы: ок', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'fac-1',
      faculty: { universityId: 'uni-1' },
    })
    prisma.post.findFirst.mockResolvedValue(postRow())
    const res = await service.create(
      viewer(Role.STUDENT, {
        sub: 's1',
        universityId: 'uni-1',
        facultyId: 'fac-1',
        groupId: 'grp-1',
      }),
      { audience: 'GROUP', content: 'привет' },
      ctx,
    )
    expect(res.id).toBe('p-new')
    expect(prisma.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ audience: 'GROUP', groupId: 'grp-1', authorId: 's1' }),
      }),
    )
  })

  it('студент → UNIVERSITY: FORBIDDEN (недоступная аудитория)', async () => {
    const { service } = setup()
    const err = await service
      .create(
        viewer(Role.STUDENT, { universityId: 'uni-1', groupId: 'grp-1' }),
        { audience: 'UNIVERSITY', content: 'x' },
        ctx,
      )
      .catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('студент → GROUP чужой группы: WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'fac-1',
      faculty: { universityId: 'uni-1' },
    })
    const err = await service
      .create(
        viewer(Role.STUDENT, { groupId: 'grp-1', facultyId: 'fac-1', universityId: 'uni-1' }),
        { audience: 'GROUP', content: 'x', groupId: 'grp-OTHER' },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
  })

  it('декан → FACULTY своего факультета: ок', async () => {
    const { service, prisma } = setup()
    prisma.faculty.findUnique.mockResolvedValue({ universityId: 'uni-1' })
    prisma.post.findFirst.mockResolvedValue(postRow({ audience: 'FACULTY' }))
    const res = await service.create(
      viewer(Role.DEAN, { sub: 'd1', universityId: 'uni-1', facultyId: 'fac-1' }),
      { audience: 'FACULTY', content: 'объявление' },
      ctx,
    )
    expect(res.id).toBe('p-new')
  })

  it('декан → ALL: FORBIDDEN', async () => {
    const { service } = setup()
    const err = await service
      .create(
        viewer(Role.DEAN, { facultyId: 'fac-1', universityId: 'uni-1' }),
        { audience: 'ALL', content: 'x' },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('PERSONAL без получателя: BAD_REQUEST', async () => {
    const { service } = setup()
    const err = await service
      .create(
        viewer(Role.STUDENT, { groupId: 'grp-1' }),
        { audience: 'PERSONAL', content: 'x' },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
  })

  it('платформенный админ → ALL: ок', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue(postRow({ audience: 'ALL' }))
    const res = await service.create(
      viewer(Role.PLATFORM_ADMIN, {}),
      { audience: 'ALL', content: 'всем' },
      ctx,
    )
    expect(res.id).toBe('p-new')
  })
})

// ── 8.6 Закрепление: роль строго выше автора ────────────────────────────────
describe('PostsService.setPinned — иерархия (8.6)', () => {
  it('роль не выше автора → FORBIDDEN', async () => {
    const { service, prisma } = setup()
    // Автор — декан; закрепляет тоже декан (не выше).
    prisma.post.findFirst.mockResolvedValue({
      id: 'p1',
      authorId: 'd2',
      audience: 'FACULTY',
      universityId: 'uni-1',
      facultyId: 'fac-1',
      author: { role: Role.DEAN },
    })
    const err = await service
      .setPinned(viewer(Role.DEAN, { facultyId: 'fac-1', universityId: 'uni-1' }), 'p1', true, ctx)
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('роль выше автора и свой scope → закрепляет', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst
      .mockResolvedValueOnce({
        id: 'p1',
        authorId: 's1',
        audience: 'GROUP',
        universityId: 'uni-1',
        facultyId: 'fac-1',
        author: { role: Role.STUDENT },
      })
      .mockResolvedValueOnce(postRow({ pinnedAt: new Date() }))
    await service.setPinned(
      viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-1' }),
      'p1',
      true,
      ctx,
    )
    expect(prisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pinnedById: expect.any(String) }),
      }),
    )
  })
})

// ── 8.6 Репост ──────────────────────────────────────────────────────────────
describe('PostsService.repost — что репостить нельзя', () => {
  it('личный пост → FORBIDDEN: репост переопубликовал бы адресованное одному человеку', async () => {
    const { service, prisma } = setup()
    // Пост адресован самому зрителю — по видимости он его читает, но репостить не может.
    prisma.post.findFirst.mockResolvedValue({
      id: 'p1',
      originalPostId: null,
      audience: PostAudience.PERSONAL,
      status: 'PUBLISHED',
    })
    const err = await service
      .repost(viewer(Role.STUDENT, { groupId: 'grp-1' }), 'p1', { audience: 'GROUP' }, ctx)
      .catch((e: AppException) => e)
    expect((err as AppException).code).toBe('FORBIDDEN')
    expect(prisma.post.create).not.toHaveBeenCalled()
  })

  it('свой черновик → BAD_REQUEST: текст уехал бы наружу в цитате оригинала', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue({
      id: 'p1',
      originalPostId: null,
      audience: PostAudience.GROUP,
      status: 'DRAFT',
    })
    const err = await service
      .repost(viewer(Role.STUDENT, { groupId: 'grp-1' }), 'p1', { audience: 'GROUP' }, ctx)
      .catch((e: AppException) => e)
    expect((err as AppException).code).toBe('BAD_REQUEST')
    expect(prisma.post.create).not.toHaveBeenCalled()
  })

  it('невидимый пост → NOT_FOUND (проверка видимости осталась на месте)', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue(null)
    const err = await service
      .repost(viewer(Role.STUDENT, { groupId: 'grp-1' }), 'p1', { audience: 'GROUP' }, ctx)
      .catch((e: AppException) => e)
    expect((err as AppException).code).toBe('NOT_FOUND')
  })

  it('опубликованный пост группы → репост ссылается на первоисточник', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst
      // Репост репоста: original ведёт на исходный пост, а не на промежуточный.
      .mockResolvedValueOnce({
        id: 'p2',
        originalPostId: 'p1',
        audience: PostAudience.GROUP,
        status: 'PUBLISHED',
      })
      // Первоисточник доступен самому репостящему.
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce(postRow({ originalPostId: 'p1' }))
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'fac-1',
      faculty: { universityId: 'uni-1' },
    })
    await service.repost(
      viewer(Role.STUDENT, { groupId: 'grp-1', facultyId: 'fac-1', universityId: 'uni-1' }),
      'p2',
      { audience: 'GROUP', content: 'мой комментарий' },
      ctx,
    )
    expect(prisma.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ originalPostId: 'p1', content: 'мой комментарий' }),
      }),
    )
  })

  it('репост репоста, чей первоисточник снят или не виден → NOT_FOUND, репост не создаётся', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst
      .mockResolvedValueOnce({
        id: 'p2',
        originalPostId: 'p1',
        audience: PostAudience.GROUP,
        status: 'PUBLISHED',
      })
      // Первоисточник удалён модератором или адресован чужой аудитории.
      .mockResolvedValueOnce(null)
    const err = await service
      .repost(viewer(Role.STUDENT, { groupId: 'grp-1' }), 'p2', { audience: 'GROUP' }, ctx)
      .catch((e: AppException) => e)
    expect((err as AppException).code).toBe('NOT_FOUND')
    const sourceWhere = prisma.post.findFirst.mock.calls[1][0].where
    expect(sourceWhere).toMatchObject({ id: 'p1', status: 'PUBLISHED', deletedAt: null })
    expect(prisma.post.create).not.toHaveBeenCalled()
  })

  it('видимость репостящего — без scope модерации: снимать пост ≠ распространять его', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue(null)
    await service
      .repost(
        viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-1' }),
        'p1',
        { audience: 'UNIVERSITY' },
        ctx,
      )
      .catch(() => undefined)
    const where = prisma.post.findFirst.mock.calls[0][0].where
    expect(hasClause(where, { universityId: 'uni-1', status: 'PUBLISHED' })).toBe(false)
  })
})

// ── Цитата оригинала у репоста (E-F02) ──────────────────────────────────────
describe('PostsService — цитата оригинала только для того, кто вправе его открыть', () => {
  const quote = (id: string) => ({
    id,
    title: 'Снятый пост',
    content: 'текст оригинала',
    author: { id: 't1', firstName: 'A', lastName: 'B', role: Role.TEACHER, avatarUrl: null },
  })

  it('лента: оригинал удалён или чужой аудитории → original: null, originalPostId остаётся', async () => {
    const { service, prisma } = setup()
    prisma.post.findMany
      .mockResolvedValueOnce([
        postRow({ id: 'r1', originalPostId: 'o-hidden', original: quote('o-hidden') }),
        postRow({ id: 'r2', originalPostId: 'o-ok', original: quote('o-ok') }),
        postRow({ id: 'p3' }),
      ])
      // Проверка оригиналов: из двух виден только один.
      .mockResolvedValueOnce([{ id: 'o-ok' }])

    const res = await service.feed(
      viewer(Role.STUDENT, { sub: 's1', universityId: 'uni-1', groupId: 'grp-1' }),
      { limit: 20 },
    )

    const byId = Object.fromEntries(res.items.map((p) => [p.id, p]))
    expect(byId.r1?.original).toBeNull()
    expect(byId.r1?.originalPostId).toBe('o-hidden')
    expect(byId.r2?.original?.content).toBe('текст оригинала')
    // Один запрос на страницу: только id оригиналов, только опубликованные, по видимости
    // зрителя (снятый пост отсекает deletedAt: null внутри видимости).
    const check = prisma.post.findMany.mock.calls[1][0]
    expect(check.select).toEqual({ id: true })
    expect(check.take).toBe(2)
    expect(check.where.AND[0]).toEqual({ id: { in: ['o-hidden', 'o-ok'] } })
    expect(check.where.AND).toContainEqual({ status: 'PUBLISHED' })
    expect(check.where.AND[2].deletedAt).toBeNull()
    // Студент не видит постов для преподавателей — и их цитаты тоже.
    expect(hasClause(check.where.AND[2], { audience: 'TEACHERS' })).toBe(false)
  })

  it('страница без репостов не делает лишнего запроса', async () => {
    const { service, prisma } = setup()
    prisma.post.findMany.mockResolvedValueOnce([postRow({ id: 'p1' })])
    await service.feed(viewer(Role.STUDENT, { groupId: 'grp-1' }), { limit: 20 })
    expect(prisma.post.findMany).toHaveBeenCalledTimes(1)
  })

  it('пост по id: недоступный оригинал → original: null', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue(
      postRow({ id: 'r1', originalPostId: 'o1', original: quote('o1') }),
    )
    prisma.post.findMany.mockResolvedValueOnce([])
    const res = await service.getById(viewer(Role.STUDENT, { groupId: 'grp-1' }), 'r1')
    expect(res.original).toBeNull()
    expect(res.originalPostId).toBe('o1')
  })

  it('пост по id: доступный оригинал остаётся в ответе', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue(
      postRow({ id: 'r1', originalPostId: 'o1', original: quote('o1') }),
    )
    prisma.post.findMany.mockResolvedValueOnce([{ id: 'o1' }])
    const res = await service.getById(viewer(Role.STUDENT, { groupId: 'grp-1' }), 'r1')
    expect(res.original?.id).toBe('o1')
  })
})

// ── Лента модерации (E-F03) ─────────────────────────────────────────────────
describe('PostsService.feed — filter=MODERATION', () => {
  async function moderationWhere(v: JwtPayload) {
    const { service, prisma } = setup()
    await service.feed(v, { limit: 20, filter: 'MODERATION' })
    return prisma.post.findMany.mock.calls[0][0]
  }

  it('модератор платформы видит посты всех вузов, кроме личных, только опубликованные', async () => {
    const arg = await moderationWhere(viewer(Role.PLATFORM_MODERATOR))
    expect(arg.where).toEqual({
      deletedAt: null,
      status: 'PUBLISHED',
      audience: { not: 'PERSONAL' },
    })
    // Модерации нужен поток свежего: новые сверху, без закреплённых впереди.
    expect(arg.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }])
  })

  it('админ и модератор вуза — все аудитории своего вуза, включая группы и преподавателей', async () => {
    for (const role of [Role.UNIVERSITY_ADMIN, Role.UNIVERSITY_MODERATOR]) {
      const arg = await moderationWhere(viewer(role, { universityId: 'uni-1' }))
      expect(arg.where).toMatchObject({ universityId: 'uni-1', audience: { not: 'PERSONAL' } })
    }
  })

  it('декан — свой факультет', async () => {
    const arg = await moderationWhere(
      viewer(Role.DEAN, { universityId: 'uni-1', facultyId: 'fac-1' }),
    )
    expect(arg.where).toMatchObject({ facultyId: 'fac-1', status: 'PUBLISHED' })
    expect(arg.where.universityId).toBeUndefined()
  })

  it('декан без факультета получает пустую выдачу, а не всю платформу', async () => {
    const arg = await moderationWhere(viewer(Role.DEAN, { universityId: 'uni-1' }))
    expect(arg.where).toMatchObject({ id: { in: [] } })
  })

  it('authorId сужает выдачу модерации, не расширяя её', async () => {
    const { service, prisma } = setup()
    await service.feed(viewer(Role.UNIVERSITY_MODERATOR, { universityId: 'uni-1' }), {
      limit: 20,
      filter: 'MODERATION',
      authorId: 's1',
    })
    const where = prisma.post.findMany.mock.calls[0][0].where
    expect(where.AND[0]).toEqual({ authorId: 's1' })
    expect(where.AND[1]).toMatchObject({ universityId: 'uni-1' })
  })

  it('не модератор → FORBIDDEN, в базу не идём', async () => {
    for (const role of [Role.STUDENT, Role.TEACHER, Role.STAROSTA, Role.EMPLOYER]) {
      const { service, prisma } = setup()
      const err = await service
        .feed(viewer(role, { universityId: 'uni-1', groupId: 'grp-1' }), {
          limit: 20,
          filter: 'MODERATION',
        })
        .catch((e: AppException) => e)
      expect((err as AppException).code).toBe('FORBIDDEN')
      expect(prisma.post.findMany).not.toHaveBeenCalled()
    }
  })

  it('личная лента модератора не превращается в поток всего вуза', async () => {
    const { service, prisma } = setup()
    await service.feed(viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-1' }), { limit: 20 })
    const where = prisma.post.findMany.mock.calls[0][0].where
    expect(hasClause(where, { universityId: 'uni-1', status: 'PUBLISHED' })).toBe(false)
  })

  it('пост по id: модератору открывается в его scope (медиа и комментарии того же права)', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue(postRow({ id: 'p1' }))
    await service.getById(viewer(Role.UNIVERSITY_MODERATOR, { universityId: 'uni-1' }), 'p1')
    const where = prisma.post.findFirst.mock.calls[0][0].where
    expect(
      hasClause(where, {
        universityId: 'uni-1',
        status: 'PUBLISHED',
        deletedAt: null,
      }),
    ).toBe(true)
  })

  it('пересылка в чат — по видимости зрителя, без scope модерации', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue({ id: 'p1' })
    await service.assertVisibleToViewer(
      viewer(Role.UNIVERSITY_MODERATOR, { universityId: 'uni-1' }),
      'p1',
    )
    const where = prisma.post.findFirst.mock.calls[0][0].where
    expect(hasClause(where, { universityId: 'uni-1', status: 'PUBLISHED' })).toBe(false)
  })
})

// ── 8.5 Удаление поста ──────────────────────────────────────────────────────
describe('PostsService.remove — автор/модератор (8.5)', () => {
  it('чужой пост не-модератором → FORBIDDEN', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue({
      id: 'p1',
      authorId: 'other',
      audience: 'GROUP',
      universityId: 'uni-1',
      facultyId: 'fac-1',
      groupId: 'grp-1',
      author: { role: Role.STUDENT },
    })
    const err = await service
      .remove(viewer(Role.STUDENT, { sub: 's1', groupId: 'grp-1' }), 'p1', ctx)
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('модератор вуза не удаляет пост админа своего вуза (ранг)', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue({
      id: 'p1',
      authorId: 'ua-1',
      audience: 'UNIVERSITY',
      universityId: 'uni-1',
      facultyId: null,
      groupId: null,
      author: { role: Role.UNIVERSITY_ADMIN },
    })
    const err = await service
      .remove(viewer(Role.UNIVERSITY_MODERATOR, { sub: 'm1', universityId: 'uni-1' }), 'p1', ctx)
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.post.update).not.toHaveBeenCalled()
  })

  it('свой пост → soft delete', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue({
      id: 'p1',
      authorId: 's1',
      audience: 'GROUP',
      universityId: 'uni-1',
      facultyId: 'fac-1',
      groupId: 'grp-1',
    })
    await service.remove(viewer(Role.STUDENT, { sub: 's1' }), 'p1', ctx)
    expect(prisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    )
  })
})

// ── Медиа поста: presigned-URL по видимости ──────────────────────────────────
describe('PostsService.getMediaUrl', () => {
  it('видимый пост + медиа принадлежит посту → presigned URL', async () => {
    const { service, prisma, files } = setup()
    prisma.post.findFirst.mockResolvedValue({ id: 'p1' })
    prisma.file.findFirst.mockResolvedValue({ id: 'f1' })
    const link = await service.getMediaUrl(viewer(Role.STUDENT, { sub: 's1' }), 'p1', 'f1')
    expect(link.url).toBe('https://minio/signed')
    expect(link.status).toBe('READY')
    expect(prisma.file.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'f1', postId: 'p1' } }),
    )
    expect(files.getPresignedUrl).toHaveBeenCalledWith('f1')
  })

  it('пост не виден зрителю → NOT_FOUND (URL не выдаётся)', async () => {
    const { service, prisma, files } = setup()
    prisma.post.findFirst.mockResolvedValue(null)
    await expect(
      service.getMediaUrl(viewer(Role.STUDENT, { sub: 's1' }), 'p1', 'f1'),
    ).rejects.toBeInstanceOf(AppException)
    expect(files.getPresignedUrl).not.toHaveBeenCalled()
  })

  it('файл не принадлежит посту → NOT_FOUND', async () => {
    const { service, prisma, files } = setup()
    prisma.post.findFirst.mockResolvedValue({ id: 'p1' })
    prisma.file.findFirst.mockResolvedValue(null)
    await expect(
      service.getMediaUrl(viewer(Role.STUDENT, { sub: 's1' }), 'p1', 'f-other'),
    ).rejects.toBeInstanceOf(AppException)
    expect(files.getPresignedUrl).not.toHaveBeenCalled()
  })
})

describe('PostsService.addComment — максимальная вложенность 1', () => {
  it('ответ на ответ прикрепляется к корню ветки (parentId родителя)', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue({ id: 'p1' })
    prisma.comment.findFirst.mockResolvedValue({ id: 'reply1', parentId: 'root1' })
    prisma.comment.create.mockResolvedValue({ id: 'c-new' })
    await service.addComment(viewer(Role.STUDENT, { sub: 's1' }), 'p1', {
      content: 'x',
      parentId: 'reply1',
    })
    expect(prisma.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parentId: 'root1' }) }),
    )
  })

  it('ответ на корневой комментарий сохраняет его id как parentId', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue({ id: 'p1' })
    prisma.comment.findFirst.mockResolvedValue({ id: 'root1', parentId: null })
    prisma.comment.create.mockResolvedValue({ id: 'c-new' })
    await service.addComment(viewer(Role.STUDENT, { sub: 's1' }), 'p1', {
      content: 'x',
      parentId: 'root1',
    })
    expect(prisma.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parentId: 'root1' }) }),
    )
  })
})

describe('PostsService.incrementView', () => {
  it('видимый пост → инкремент, возвращает views', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue({ id: 'p1' })
    prisma.post.update.mockResolvedValue({ views: 5 })
    const res = await service.incrementView(viewer(Role.STUDENT, { sub: 's1' }), 'p1')
    expect(res.views).toBe(5)
    expect(prisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { views: { increment: 1 } } }),
    )
  })

  it('невидимый пост → NOT_FOUND, без инкремента', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue(null)
    await expect(service.incrementView(viewer(Role.STUDENT), 'p1')).rejects.toBeInstanceOf(
      AppException,
    )
    expect(prisma.post.update).not.toHaveBeenCalled()
  })
})

describe('PostsService — черновики и отложенная публикация (Ф2)', () => {
  it('status DRAFT → сохраняется как черновик без publishedAt', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue(postRow())
    await service.create(
      viewer(Role.PLATFORM_ADMIN),
      { audience: 'ALL', content: 'x', status: 'DRAFT' },
      ctx,
    )
    const data = prisma.post.create.mock.calls[0][0].data
    expect(data.status).toBe('DRAFT')
    expect(data.publishedAt).toBeNull()
  })

  it('scheduledAt в будущем → status SCHEDULED', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue(postRow())
    const future = new Date(Date.now() + 3_600_000)
    await service.create(
      viewer(Role.PLATFORM_ADMIN),
      { audience: 'ALL', content: 'x', scheduledAt: future },
      ctx,
    )
    const data = prisma.post.create.mock.calls[0][0].data
    expect(data.status).toBe('SCHEDULED')
    expect(data.scheduledAt).toBe(future)
    expect(data.publishedAt).toBeNull()
  })

  it('по умолчанию → PUBLISHED с publishedAt', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue(postRow())
    await service.create(viewer(Role.PLATFORM_ADMIN), { audience: 'ALL', content: 'x' }, ctx)
    const data = prisma.post.create.mock.calls[0][0].data
    expect(data.status).toBe('PUBLISHED')
    expect(data.publishedAt).toBeInstanceOf(Date)
  })

  it('общая лента скрывает черновики (status=PUBLISHED в фильтре)', async () => {
    const { service, prisma } = setup()
    prisma.post.findMany.mockResolvedValue([])
    await service.feed(viewer(Role.STUDENT, { groupId: 'grp-1' }), { limit: 20 })
    const where = prisma.post.findMany.mock.calls[0][0].where
    expect(where.AND).toContainEqual({ status: 'PUBLISHED' })
  })

  it('своя вкладка профиля показывает черновики (нет форс-PUBLISHED)', async () => {
    const { service, prisma } = setup()
    prisma.post.findMany.mockResolvedValue([])
    await service.feed(viewer(Role.STUDENT, { sub: 's1', groupId: 'grp-1' }), {
      limit: 20,
      authorId: 's1',
    })
    const where = prisma.post.findMany.mock.calls[0][0].where
    // base.AND содержит только «PUBLISHED ИЛИ автор», без отдельного форс-PUBLISHED.
    const base = where.AND[1]
    expect(base.AND).not.toContainEqual({ status: 'PUBLISHED' })
  })

  it('publish: свой черновик → PUBLISHED с publishedAt', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst
      .mockResolvedValueOnce({ id: 'p1', authorId: 'u1', status: 'DRAFT' })
      .mockResolvedValue(postRow({ id: 'p1', authorId: 'u1' }))
    await service.publish(viewer(Role.STUDENT, { sub: 'u1' }), 'p1', ctx)
    const data = prisma.post.update.mock.calls[0][0].data
    expect(data.status).toBe('PUBLISHED')
    expect(data.publishedAt).toBeInstanceOf(Date)
    expect(data.scheduledAt).toBeNull()
  })

  it('publish: чужой черновик → FORBIDDEN', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'other', status: 'DRAFT' })
    await expect(
      service.publish(viewer(Role.PLATFORM_ADMIN, { sub: 'u1' }), 'p1', ctx),
    ).rejects.toThrow()
    expect(prisma.post.update).not.toHaveBeenCalled()
  })

  // Отложенному посту выставили время — досрочная публикация по кнопке противоречила бы ему.
  it('publish: отложенный или уже опубликованный → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u1', status: 'SCHEDULED' })
    await expect(service.publish(viewer(Role.STUDENT, { sub: 'u1' }), 'p1', ctx)).rejects.toThrow()
    expect(prisma.post.update).not.toHaveBeenCalled()
  })

  it('publishDueScheduled публикует созревшие отложенные', async () => {
    const { service, prisma } = setup()
    prisma.post.updateMany.mockResolvedValue({ count: 3 })
    const n = await service.publishDueScheduled()
    expect(n).toBe(3)
    const arg = prisma.post.updateMany.mock.calls[0][0]
    expect(arg.where.status).toBe('SCHEDULED')
    expect(arg.data.status).toBe('PUBLISHED')
  })
})

describe('PostsService.update — правка только своей публикации', () => {
  it('чужой пост → FORBIDDEN, даже у модератора', async () => {
    const { service, prisma } = setup()
    // Удалять нарушающий пост модератор вправе, а переписывать чужой текст от чужого
    // имени — нет: это подмена авторства.
    prisma.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'someone-else' })
    const err = await service
      .update(viewer(Role.UNIVERSITY_ADMIN, { sub: 'admin' }), 'p1', { content: 'правка' }, ctx)
      .catch((e: AppException) => e)
    expect((err as AppException).code).toBe('FORBIDDEN')
    expect(prisma.post.update).not.toHaveBeenCalled()
  })

  it('свой пост: меняются заголовок и текст, пишется аудит', async () => {
    const { service, prisma, audit } = setup()
    prisma.post.findFirst.mockResolvedValue(postRow({ id: 'p1', authorId: 'u-1' }))
    await service.update(viewer(Role.STUDENT), 'p1', { title: '  Итоги  ', content: 'текст' }, ctx)
    expect(prisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { title: 'Итоги', content: 'текст' } }),
    )
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'post_updated' }))
  })

  it('пустой заголовок сохраняется как null, а не пустой строкой', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue(postRow({ id: 'p1', authorId: 'u-1' }))
    await service.update(viewer(Role.STUDENT), 'p1', { title: '   ' }, ctx)
    expect(prisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { title: null } }),
    )
  })

  it('удалённый пост → NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue(null)
    const err = await service
      .update(viewer(Role.STUDENT), 'p1', { content: 'текст' }, ctx)
      .catch((e: AppException) => e)
    expect((err as AppException).code).toBe('NOT_FOUND')
  })
})

// ── Избранное: личная полка ─────────────────────────────────────────────────
describe('PostsService — избранное', () => {
  it('лента помечает посты, сохранённые зрителем', async () => {
    const { service, prisma } = setup()
    prisma.post.findMany.mockResolvedValue([postRow({ id: 'p1' }), postRow({ id: 'p2' })])
    prisma.postBookmark.findMany.mockResolvedValue([{ postId: 'p2' }])

    const res = await service.feed(viewer(Role.STUDENT, { groupId: 'grp-1' }), { limit: 20 })

    expect(res.items.map((p) => [p.id, p.bookmarked])).toEqual([
      ['p1', false],
      ['p2', true],
    ])
  })

  it('признак спрашивается ТОЛЬКО за зрителя — чужие закладки наружу не уходят', async () => {
    const { service, prisma } = setup()
    prisma.post.findMany.mockResolvedValue([postRow({ id: 'p1' })])

    await service.feed(viewer(Role.STUDENT, { groupId: 'grp-1' }), { limit: 20 })

    expect(prisma.postBookmark.findMany.mock.calls[0][0].where).toEqual({
      userId: 'u-1',
      postId: { in: ['p1'] },
    })
  })

  it('пустая страница не ходит в базу за закладками', async () => {
    const { service, prisma } = setup()
    prisma.post.findMany.mockResolvedValue([])

    await service.feed(viewer(Role.STUDENT, { groupId: 'grp-1' }), { limit: 20 })

    expect(prisma.postBookmark.findMany).not.toHaveBeenCalled()
    expect(prisma.comment.groupBy).not.toHaveBeenCalled()
  })
})

// ── Счётчик комментариев ленты ──────────────────────────────────────────────
//
// `_count` отношением заставляет Postgres считать агрегат по всей таблице комментариев
// до сортировки, и планировщик из-за этого бросает индекс порядка ленты: 115 мс против
// 0,04 мс на 90 тыс. постов и 500 тыс. комментариев. Тесты стерегут форму запроса —
// вернуть `_count` в select можно одной строкой, и по коду это будет незаметно.
describe('PostsService — счётчик комментариев ленты', () => {
  it('выборка ленты идёт без _count, счётчик берётся отдельным groupBy', async () => {
    const { service, prisma } = setup()
    prisma.post.findMany.mockResolvedValue([postRow({ id: 'p1' }), postRow({ id: 'p2' })])
    prisma.comment.groupBy.mockResolvedValue([{ postId: 'p1', _count: { _all: 7 } }])

    const res = await service.feed(viewer(Role.STUDENT, { groupId: 'grp-1' }), { limit: 20 })

    expect(prisma.post.findMany.mock.calls[0][0].select._count).toBeUndefined()
    expect(prisma.comment.groupBy.mock.calls[0][0]).toMatchObject({
      by: ['postId'],
      where: { postId: { in: ['p1', 'p2'] }, deletedAt: null },
    })
    // Форма ответа прежняя: клиент читает post._count.comments.
    expect(res.items.map((p) => [p.id, p._count.comments])).toEqual([
      ['p1', 7],
      ['p2', 0],
    ])
  })

  it('одиночный пост по-прежнему со счётчиком в select — агрегат там по одному id', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue(postRow({ id: 'p1' }))

    await service.getById(viewer(Role.STUDENT, { groupId: 'grp-1' }), 'p1')

    // Удалённые комментарии не считаются — так же, как в ленте.
    expect(prisma.post.findFirst.mock.calls[0][0].select._count).toEqual({
      select: { comments: { where: { deletedAt: null } } },
    })
  })

  it('таб SAVED сужает выдачу закладкой зрителя, не отменяя видимость', async () => {
    const { service, prisma } = setup()
    prisma.post.findMany.mockResolvedValue([])

    await service.feed(viewer(Role.STUDENT, { groupId: 'grp-1' }), { limit: 20, filter: 'SAVED' })

    const where = JSON.stringify(prisma.post.findMany.mock.calls[0][0].where)
    expect(where).toContain('"bookmarks":{"some":{"userId":"u-1"}}')
    // Видимость осталась в том же AND — фильтр её не заменяет.
    expect(where).toContain('grp-1')
  })

  it('сохраняет пост, если закладки ещё нет', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue({ id: 'p1' })

    await expect(service.toggleBookmark(viewer(Role.STUDENT), 'p1')).resolves.toEqual({
      bookmarked: true,
    })
    expect(prisma.postBookmark.create).toHaveBeenCalledWith({
      data: { userId: 'u-1', postId: 'p1' },
    })
  })

  it('повторное нажатие снимает закладку, а не создаёт вторую', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue({ id: 'p1' })
    prisma.postBookmark.findUnique.mockResolvedValue({ id: 'b1' })

    await expect(service.toggleBookmark(viewer(Role.STUDENT), 'p1')).resolves.toEqual({
      bookmarked: false,
    })
    expect(prisma.postBookmark.delete).toHaveBeenCalledWith({ where: { id: 'b1' } })
    expect(prisma.postBookmark.create).not.toHaveBeenCalled()
  })

  it('нельзя сохранить пост, которого зритель не видит', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue(null)

    await expect(service.toggleBookmark(viewer(Role.STUDENT), 'p-alien')).rejects.toBeInstanceOf(
      AppException,
    )
    expect(prisma.postBookmark.create).not.toHaveBeenCalled()
  })
})

describe('PostsService.create — медиа', () => {
  it('файл уже в другом посте или чужой → BAD_REQUEST, пост откатывается вместе с транзакцией', async () => {
    const { service, prisma } = setup()
    prisma.post.create.mockResolvedValue({ id: 'p-new' })
    prisma.file.updateMany.mockResolvedValue({ count: 1 })
    const err = await service
      .create(
        viewer(Role.PLATFORM_ADMIN),
        { audience: 'ALL', content: 'текст', mediaIds: ['f1', 'f2'] } as never,
        { ip: '127.0.0.1', userAgent: 'jest' },
      )
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(prisma.file.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['f1', 'f2'] }, ownerId: 'u-1', bucket: 'posts-media', postId: null },
      data: { postId: 'p-new' },
    })
  })
})

// ── Реакции и медиа выдачи (E-F04, E-F05) ───────────────────────────────────
describe('PostsService — сводка реакций вместо всех строк', () => {
  it('реакция — только из белого списка: произвольная строка не проходит валидацию', () => {
    expect(ReactionSchema.safeParse({ emoji: '❤️' }).success).toBe(true)
    // Все реакции мобильных клиентов (👍 🔥 ❤️) проходят.
    for (const emoji of ['👍', '🔥']) {
      expect(ReactionSchema.safeParse({ emoji }).success).toBe(true)
    }
    expect(ReactionSchema.safeParse({ emoji: 'a1' }).success).toBe(false)
    expect(ReactionSchema.safeParse({ emoji: '💩' }).success).toBe(false)
  })

  it('лента: счётчики groupBy по id страницы, свои — отдельным запросом за зрителя', async () => {
    const { service, prisma } = setup()
    prisma.post.findMany.mockResolvedValue([postRow({ id: 'p1' }), postRow({ id: 'p2' })])
    prisma.reaction.groupBy.mockResolvedValue([
      { postId: 'p1', emoji: '🔥', _count: { _all: 2 } },
      { postId: 'p1', emoji: '❤️', _count: { _all: 1200 } },
    ])
    prisma.reaction.findMany.mockResolvedValue([{ postId: 'p1', emoji: '❤️' }])

    const res = await service.feed(viewer(Role.STUDENT, { sub: 's1', groupId: 'grp-1' }), {
      limit: 20,
    })

    const groupBy = prisma.reaction.groupBy.mock.calls[0][0]
    expect(groupBy.by).toEqual(['postId', 'emoji'])
    expect(groupBy.where.postId).toEqual({ in: ['p1', 'p2'] })
    expect(groupBy.where.emoji.in).toEqual([...POST_REACTION_EMOJIS])
    const mine = prisma.reaction.findMany.mock.calls[0][0]
    expect(mine.where).toMatchObject({ userId: 's1', postId: { in: ['p1', 'p2'] } })
    expect(mine.take).toBe(2 * POST_REACTION_EMOJIS.length)
    // Порядок — как в белом списке, а не как вернул groupBy.
    expect(res.items[0]?.reactionSummary).toEqual([
      { emoji: '❤️', count: 1200, mine: true },
      { emoji: '🔥', count: 2, mine: false },
    ])
    expect(res.items[1]?.reactionSummary).toEqual([])
  })

  it('построчные реакции — по умолчанию (мобильные клиенты), но только из белого списка', async () => {
    const { service, prisma } = setup()
    await service.feed(viewer(Role.STUDENT, { groupId: 'grp-1' }), { limit: 20 })
    expect(prisma.post.findMany.mock.calls[0][0].select.reactions).toEqual({
      where: { emoji: { in: [...POST_REACTION_EMOJIS] } },
      select: { emoji: true, userId: true },
    })
  })

  it('reactions=summary: строки реакций в выборку не попадают вовсе', async () => {
    const { service, prisma } = setup()
    await service.feed(viewer(Role.STUDENT, { groupId: 'grp-1' }), {
      limit: 20,
      reactions: 'summary',
    })
    expect(prisma.post.findMany.mock.calls[0][0].select.reactions).toBeUndefined()
  })

  it('пост по id: тоже сводка, а счётчик комментариев не считается второй раз', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue(postRow({ id: 'p1', _count: { comments: 3 } }))
    prisma.reaction.groupBy.mockResolvedValue([{ postId: 'p1', emoji: '👍', _count: { _all: 4 } }])

    const res = await service.getById(viewer(Role.STUDENT, { groupId: 'grp-1' }), 'p1')

    expect(res.reactionSummary).toEqual([{ emoji: '👍', count: 4, mine: false }])
    expect(res._count.comments).toBe(3)
    expect(prisma.comment.groupBy).not.toHaveBeenCalled()
  })
})

describe('PostsService — ссылки на медиа прямо в выдаче', () => {
  it('лента подписывает медиа всей страницы одной пачкой', async () => {
    const { service, prisma, files, media } = setup()
    prisma.post.findMany.mockResolvedValue([
      postRow({ id: 'p1', media: [mediaRow('f1'), mediaRow('f2')] }),
      postRow({ id: 'p2', media: [mediaRow('f3')] }),
      postRow({ id: 'p3' }),
    ])

    const res = await service.feed(viewer(Role.STUDENT, { groupId: 'grp-1' }), { limit: 20 })

    expect(files.getPresignedUrls).toHaveBeenCalledTimes(1)
    expect(files.getPresignedUrls).toHaveBeenCalledWith(['f1', 'f2', 'f3'])
    expect(media.describe).toHaveBeenCalledTimes(1)
    expect(files.getPresignedUrl).not.toHaveBeenCalled()
    const first = res.items[0]?.media[0]
    expect(first).toMatchObject({
      id: 'f1',
      mime: 'image/jpeg',
      width: 1200,
      height: 800,
      mediaStatus: 'READY',
      status: 'READY',
      url: 'https://minio/f1',
      sources: [{ width: 640, height: 427, url: 'https://minio/f1-640' }],
    })
    expect(typeof first?.expiresAt).toBe('string')
    // Бакет и ключи вариантов — внутреннее хранилища, наружу не уходят.
    expect(first).not.toHaveProperty('bucket')
    expect(first).not.toHaveProperty('variants')
    expect(res.items[2]?.media).toEqual([])
  })

  it('файл исчез до подписи — медиа без url, клиент спросит ссылку отдельно', async () => {
    const { service, prisma, files } = setup()
    prisma.post.findMany.mockResolvedValue([postRow({ id: 'p1', media: [mediaRow('f1')] })])
    files.getPresignedUrls.mockResolvedValueOnce(new Map())

    const res = await service.feed(viewer(Role.STUDENT, { groupId: 'grp-1' }), { limit: 20 })

    expect(res.items[0]?.media[0]?.id).toBe('f1')
    expect(res.items[0]?.media[0]).not.toHaveProperty('url')
  })

  it('выборка медиа берёт поля описания с вариантами (MEDIA_FILE_SELECT)', async () => {
    const { service, prisma } = setup()
    await service.feed(viewer(Role.STUDENT, { groupId: 'grp-1' }), { limit: 20 })
    expect(prisma.post.findMany.mock.calls[0][0].select.media).toEqual({
      select: MEDIA_FILE_SELECT,
    })
  })
})
