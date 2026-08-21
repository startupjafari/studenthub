import { PostAudience } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { PostsService } from './posts.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { ConfigService } from '@nestjs/config'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import { AppException } from '../../common/exceptions/app.exception'

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
    },
    comment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    faculty: { findUnique: jest.fn() },
    group: { findUnique: jest.fn() },
    user: { findFirst: jest.fn() },
    file: { findMany: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn() },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const config = { get: jest.fn().mockReturnValue('posts-media') }
  const files = { getPresignedUrl: jest.fn().mockResolvedValue('https://minio/signed') }
  const service = new PostsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    config as unknown as ConfigService<EnvVars, true>,
    files as unknown as import('../files/file.service').FileService,
  )
  return { service, prisma, audit, files }
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
    })
    const err = await service
      .remove(viewer(Role.STUDENT, { sub: 's1', groupId: 'grp-1' }), 'p1', ctx)
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
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
    const url = await service.getMediaUrl(viewer(Role.STUDENT, { sub: 's1' }), 'p1', 'f1')
    expect(url).toBe('https://minio/signed')
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
