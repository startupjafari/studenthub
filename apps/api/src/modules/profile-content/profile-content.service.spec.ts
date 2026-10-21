import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { PROFILE_MEDIA_QUOTA, PROFILE_MEDIA_QUOTA_FIELD } from '@studenthub/shared-config'
import { Role } from '@studenthub/shared-types'
import { PrismaService } from '../../common/prisma/prisma.service'
import { FileService } from '../files/file.service'
import { UserService } from '../users/users.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { EnvVars } from '../../config/env.schema'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { ProfileContentService } from './profile-content.service'
import type { QueueService } from '../../common/queue'
import { Paginated } from '../../common/http/paginated'

function user(sub: string): JwtPayload {
  return { sub, role: Role.STUDENT, universityId: 'u', facultyId: 'f', groupId: 'g' }
}

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

const CONFIG: Record<string, unknown> = {
  MINIO_BUCKET_PROFILE_MEDIA: 'profile-media',
  MINIO_BUCKET_PROFILE_COVERS: 'profile-covers',
  MINIO_USE_SSL: false,
  MINIO_ENDPOINT: 'localhost',
  MINIO_PORT: 9000,
}

function setup() {
  const prisma = {
    user: { findUnique: jest.fn() },
    profileArticle: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    album: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    file: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      // Квота медиа: по умолчанию у пользователя пусто.
      aggregate: jest.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: { size: null } }),
    },
    bookmark: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    contentComment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    userBlock: { findFirst: jest.fn().mockResolvedValue(null) },
  }
  const files = {
    upload: jest.fn(),
    delete: jest.fn(),
    removeRawObject: jest.fn(),
    findOrThrow: jest.fn(),
    listByOwnerAndBucket: jest.fn(),
    presignPut: jest.fn(),
    confirmDirectUpload: jest.fn(),
    putAuxImage: jest.fn(),
  }
  const config = { get: (k: string) => CONFIG[k] }
  // По умолчанию профиль открыт смотрящему; закрытый проверяется отдельным тестом.
  const users = {
    canViewProfileContent: jest.fn().mockResolvedValue(true),
    canViewProfileContentOf: jest.fn().mockResolvedValue(true),
    // По умолчанию виден контент всех переданных владельцев.
    viewableProfileContentOwners: jest.fn(
      async (_viewer: JwtPayload, owners: { id: string }[]) => new Set(owners.map((o) => o.id)),
    ),
  }
  // Описание медиа — media.service.spec.ts; здесь — «ещё не обработано», без вариантов.
  const media = {
    describeOne: jest.fn(async (f: { mediaStatus?: string; placeholder?: string | null }) => ({
      status: f.mediaStatus ?? 'NONE',
      placeholder: f.placeholder ?? null,
      width: null,
      height: null,
      durationMs: null,
      sources: [],
      poster: [],
      hls: null,
      expiresAt: null,
    })),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  // Просмотры: SADD в множество зрителей дня (posts/unique-view.ts). По умолчанию — первый.
  const redisMulti = {
    sadd: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([
      [null, 1],
      [null, 1],
    ]),
  }
  const redis = { multi: jest.fn(() => redisMulti) }
  // Число опросов — у модуля опросов (countVisibleByUser), здесь только итог.
  const polls = { countVisibleByUser: jest.fn().mockResolvedValue(0) }
  const service = new ProfileContentService(
    prisma as unknown as PrismaService,
    files as unknown as FileService,
    config as unknown as ConfigService<EnvVars, true>,
    users as unknown as UserService,
    media as never,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
    redis as never,
    polls as never,
  )
  return { service, prisma, files, users, media, audit, queue, redisMulti, polls }
}

// Владелец контента — поля PROFILE_CONTENT_OWNER_SELECT.
const owner = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  role: Role.STUDENT,
  profileVisibility: 'UNIVERSITY',
  universityId: 'u',
  facultyId: 'f',
  groupId: 'g',
  deletedAt: null,
  ...over,
})

const file = (over: Record<string, unknown> = {}) => ({
  id: 'file1',
  bucket: 'profile-media',
  key: 'file1.jpg',
  mime: 'image/jpeg',
  size: 1000,
  ownerId: 'me',
  createdAt: new Date('2026-01-01'),
  ...over,
})

describe('ProfileContentService — медиа', () => {
  it('отклоняет не фото/видео и откатывает файл', async () => {
    const { service, files } = setup()
    files.upload.mockResolvedValue(file({ mime: 'application/pdf' }))
    const err = await service.uploadMedia(user('me'), Buffer.from('x')).catch((e) => e)
    expect(err.code).toBe('FILE_TYPE_NOT_ALLOWED')
    expect(files.delete).toHaveBeenCalledWith('file1', 'me')
  })

  it('принимает изображение и строит публичный URL', async () => {
    const { service, files } = setup()
    files.upload.mockResolvedValue(file())
    const dto = await service.uploadMedia(user('me'), Buffer.from('x'))
    expect(dto.type).toBe('PHOTO')
    expect(dto.url).toBe('http://localhost:9000/profile-media/file1.jpg')
  })

  it('классифицирует видео как VIDEO', async () => {
    const { service, prisma } = setup()
    prisma.file.findMany.mockResolvedValue([file({ mime: 'video/mp4', key: 'v.mp4' })])
    const list = await service.listMedia(user('me'), 'me')
    expect(list[0]?.type).toBe('VIDEO')
  })

  it('не даёт удалить чужой файл / файл из другого бакета', async () => {
    const { service, files } = setup()
    files.findOrThrow.mockResolvedValue(file({ ownerId: 'other' }))
    const err = await service.deleteMedia(user('me'), 'file1', ctx).catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(files.delete).not.toHaveBeenCalled()
  })

  it('presign отклоняет не фото/видео', async () => {
    const { service, files } = setup()
    const err = await service
      .presignMedia(user('me'), { mime: 'application/pdf', size: 5 })
      .catch((e) => e)
    expect(err.code).toBe('FILE_TYPE_NOT_ALLOWED')
    expect(files.presignPut).not.toHaveBeenCalled()
  })

  it('presign видео → отдаёт ключ и URL', async () => {
    const { service, files } = setup()
    files.presignPut.mockResolvedValue({ key: 'k.mp4', url: 'http://put' })
    const res = await service.presignMedia(user('me'), { mime: 'video/mp4', size: 20_000_000 })
    expect(res.url).toBe('http://put')
    // Владелец уходит в presignPut третьим аргументом: ключ префиксируется им, и только
    // такой ключ примет confirm (иначе можно подтвердить чужой объект как свой).
    expect(files.presignPut).toHaveBeenCalledWith('profile-media', 'video/mp4', 'me')
  })

  it('confirm создаёт медиа-DTO', async () => {
    const { service, files } = setup()
    files.confirmDirectUpload.mockResolvedValue(file({ mime: 'video/mp4', key: 'me/k.mp4' }))
    const dto = await service.confirmMedia(user('me'), { key: 'me/k.mp4', mime: 'video/mp4' })
    expect(dto.type).toBe('VIDEO')
  })
})

// E-F26: квота медиа профиля — число файлов и суммарный объём на пользователя.
describe('ProfileContentService — квота медиа', () => {
  const usage = (files: number, bytes: number) => ({
    _count: { _all: files },
    _sum: { size: bytes },
  })
  const GB = 1024 ** 3

  it('на потолке числа файлов загрузка отклоняется до записи в хранилище', async () => {
    const { service, prisma, files } = setup()
    prisma.file.aggregate.mockResolvedValue(usage(PROFILE_MEDIA_QUOTA.MAX_FILES, 1000))
    const err = await service.uploadMedia(user('me'), Buffer.from('x')).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(err.details).toEqual([{ field: PROFILE_MEDIA_QUOTA_FIELD, message: 'files' }])
    expect(files.upload).not.toHaveBeenCalled()
    // Считается только своё медиа профиля, а не все файлы пользователя.
    expect(prisma.file.aggregate.mock.calls[0][0].where).toEqual({
      ownerId: 'me',
      bucket: 'profile-media',
    })
  })

  it('файл не влезает в объём → CONFLICT bytes, файл не заливается', async () => {
    const { service, prisma, files } = setup()
    prisma.file.aggregate.mockResolvedValue(usage(10, PROFILE_MEDIA_QUOTA.MAX_BYTES - 5))
    const err = await service.uploadMedia(user('me'), Buffer.alloc(10)).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(err.details[0].message).toBe('bytes')
    expect(files.upload).not.toHaveBeenCalled()
  })

  it('параллельная загрузка перешла потолок → свой файл удаляется, CONFLICT', async () => {
    const { service, prisma, files } = setup()
    const max = PROFILE_MEDIA_QUOTA.MAX_FILES
    // До записи место было, после — уже перебор (вторая загрузка успела раньше).
    prisma.file.aggregate
      .mockResolvedValueOnce(usage(max - 1, 0))
      .mockResolvedValueOnce(usage(max + 1, 0))
    files.upload.mockResolvedValue(file())
    const err = await service.uploadMedia(user('me'), Buffer.from('x')).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(files.delete).toHaveBeenCalledWith('file1', 'me')
  })

  it('в пределах квоты загрузка проходит, файл не удаляется', async () => {
    const { service, prisma, files } = setup()
    prisma.file.aggregate.mockResolvedValue(usage(PROFILE_MEDIA_QUOTA.MAX_FILES - 1, GB))
    files.upload.mockResolvedValue(file())
    const dto = await service.uploadMedia(user('me'), Buffer.from('x'))
    expect(dto.id).toBe('file1')
    expect(files.delete).not.toHaveBeenCalled()
  })

  it('presign: заявленный размер сверх остатка → CONFLICT, ссылки нет', async () => {
    const { service, prisma, files } = setup()
    prisma.file.aggregate.mockResolvedValue(usage(1, PROFILE_MEDIA_QUOTA.MAX_BYTES - 1000))
    const err = await service
      .presignMedia(user('me'), { mime: 'video/mp4', size: 20_000_000 })
      .catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(files.presignPut).not.toHaveBeenCalled()
  })

  it('confirm: настоящий размер перешёл квоту → файл и объект удаляются, CONFLICT', async () => {
    const { service, prisma, files } = setup()
    prisma.file.aggregate.mockResolvedValue(usage(3, PROFILE_MEDIA_QUOTA.MAX_BYTES + 1))
    files.confirmDirectUpload.mockResolvedValue(file({ mime: 'video/mp4', key: 'me/k.mp4' }))
    const err = await service
      .confirmMedia(user('me'), { key: 'me/k.mp4', mime: 'video/mp4' })
      .catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(err.details[0]).toEqual({ field: PROFILE_MEDIA_QUOTA_FIELD, message: 'bytes' })
    expect(files.delete).toHaveBeenCalledWith('file1', 'me')
  })
})

// E-F26: замена обложки видео — прежняя удаляется только после записи новой.
describe('ProfileContentService — обложка видео', () => {
  const video = file({ mime: 'video/mp4', key: 'v.mp4', posterKey: 'old.jpg' })

  it('новая обложка → запись → удаление прежней', async () => {
    const { service, prisma, files } = setup()
    files.findOrThrow.mockResolvedValue(video)
    files.putAuxImage.mockResolvedValue('new.jpg')
    prisma.file.update.mockResolvedValue({ ...video, posterKey: 'new.jpg' })
    const dto = await service.attachPoster(user('me'), 'file1', Buffer.from('x'))
    expect(dto.posterUrl).toBe('http://localhost:9000/profile-covers/new.jpg')
    expect(prisma.file.update.mock.calls[0][0].data).toEqual({ posterKey: 'new.jpg' })
    expect(files.removeRawObject).toHaveBeenCalledTimes(1)
    expect(files.removeRawObject).toHaveBeenCalledWith('profile-covers', 'old.jpg')
    const putOrder = files.putAuxImage.mock.invocationCallOrder[0]!
    const updateOrder = prisma.file.update.mock.invocationCallOrder[0]!
    const removeOrder = files.removeRawObject.mock.invocationCallOrder[0]!
    expect(putOrder).toBeLessThan(updateOrder)
    expect(updateOrder).toBeLessThan(removeOrder)
  })

  it('невалидная новая обложка → прежняя цела, запись не меняется', async () => {
    const { service, prisma, files } = setup()
    files.findOrThrow.mockResolvedValue(video)
    files.putAuxImage.mockRejectedValue(
      Object.assign(new Error('not image'), { code: 'FILE_TYPE_NOT_ALLOWED' }),
    )
    const err = await service.attachPoster(user('me'), 'file1', Buffer.from('x')).catch((e) => e)
    expect(err.code).toBe('FILE_TYPE_NOT_ALLOWED')
    expect(prisma.file.update).not.toHaveBeenCalled()
    expect(files.removeRawObject).not.toHaveBeenCalled()
  })

  it('запись не обновилась (видео удалили) → убирается новая обложка, а не прежняя', async () => {
    const { service, prisma, files } = setup()
    files.findOrThrow.mockResolvedValue(video)
    files.putAuxImage.mockResolvedValue('new.jpg')
    prisma.file.update.mockRejectedValue(new Error('P2025'))
    await expect(service.attachPoster(user('me'), 'file1', Buffer.from('x'))).rejects.toThrow(
      'P2025',
    )
    expect(files.removeRawObject).toHaveBeenCalledTimes(1)
    expect(files.removeRawObject).toHaveBeenCalledWith('profile-covers', 'new.jpg')
  })
})

describe('ProfileContentService — статьи владение', () => {
  const article = {
    title: 't',
    content: 'c',
    visibility: 'ALL' as const,
    allowComments: true,
    status: 'PUBLISHED' as const,
  }

  it('update чужой статьи → FORBIDDEN', async () => {
    const { service, prisma } = setup()
    prisma.profileArticle.findUnique.mockResolvedValue({ userId: 'other' })
    const err = await service.updateArticle(user('me'), 'a1', article).catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.profileArticle.update).not.toHaveBeenCalled()
  })

  it('delete несуществующей статьи → NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.profileArticle.findUnique.mockResolvedValue(null)
    const err = await service.deleteArticle(user('me'), 'a1', ctx).catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })

  it('createArticle со статусом PUBLISHED проставляет publishedAt', async () => {
    const { service, prisma } = setup()
    prisma.profileArticle.create.mockResolvedValue({
      id: 'a1',
      _count: { comments: 0, bookmarks: 0 },
    })
    await service.createArticle(user('me'), article)
    expect(prisma.profileArticle.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ publishedAt: expect.any(Date) }) }),
    )
  })

  it('обложка из своего бакета принимается', async () => {
    const { service, prisma } = setup()
    prisma.profileArticle.create.mockResolvedValue({
      id: 'a1',
      _count: { comments: 0, bookmarks: 0 },
    })
    const coverUrl = 'http://localhost:9000/profile-media/cover.webp'
    await service.createArticle(user('me'), { ...article, coverUrl })
    expect(prisma.profileArticle.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ coverUrl }) }),
    )
  })

  it('обложка с чужого хоста → BAD_REQUEST, статья не создаётся', async () => {
    const { service, prisma } = setup()
    const err = await service
      .createArticle(user('me'), { ...article, coverUrl: 'https://evil.example/pixel.png' })
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(prisma.profileArticle.create).not.toHaveBeenCalled()
  })

  it('createArticle со статусом DRAFT → publishedAt = null', async () => {
    const { service, prisma } = setup()
    prisma.profileArticle.create.mockResolvedValue({
      id: 'a1',
      _count: { comments: 0, bookmarks: 0 },
    })
    await service.createArticle(user('me'), { ...article, status: 'DRAFT' as const })
    expect(prisma.profileArticle.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ publishedAt: null }) }),
    )
  })

  it('incrementArticleView владельца → инкремент, возвращает views', async () => {
    const { service, prisma } = setup()
    prisma.profileArticle.findUnique.mockResolvedValue({
      userId: 'me',
      status: 'DRAFT',
      visibility: 'ALL',
      user: {},
    })
    prisma.profileArticle.update.mockResolvedValue({ views: 7 })
    const res = await service.incrementArticleView(user('me'), 'a1')
    expect(res.views).toBe(7)
    expect(prisma.profileArticle.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { views: { increment: 1 } } }),
    )
  })

  it('relatedArticles по категории (владелец)', async () => {
    const { service, prisma } = setup()
    prisma.profileArticle.findUnique.mockResolvedValue({
      userId: 'me',
      category: 'GUIDE',
      tags: [],
      user: owner('me'),
    })
    prisma.profileArticle.findMany.mockResolvedValue([
      { id: 'a2', _count: { comments: 0, bookmarks: 0 } },
    ])
    const res = await service.relatedArticles(user('me'), 'a1')
    expect(res).toHaveLength(1)
    const where = prisma.profileArticle.findMany.mock.calls[0][0].where
    expect(where.userId).toBe('me')
    expect(where.id).toEqual({ not: 'a1' })
    expect(where.OR).toContainEqual({ category: 'GUIDE' })
  })
})

describe('ProfileContentService — альбомы (Ф3)', () => {
  it('createAlbum → DTO с нулевой обложкой и count 0', async () => {
    const { service, prisma } = setup()
    prisma.album.create.mockResolvedValue({ id: 'al1', title: 'Лето', createdAt: new Date() })
    const res = await service.createAlbum(user('me'), { title: 'Лето' })
    expect(res).toMatchObject({ id: 'al1', title: 'Лето', coverUrl: null, count: 0 })
  })

  it('assignAlbumMedia в чужой альбом → FORBIDDEN', async () => {
    const { service, prisma } = setup()
    prisma.album.findUnique.mockResolvedValue({ userId: 'other' })
    const err = await service
      .assignAlbumMedia(user('me'), 'al1', { fileIds: ['f1'] })
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.file.updateMany).not.toHaveBeenCalled()
  })

  it('assignAlbumMedia своего альбома → updateMany только своих profile-media', async () => {
    const { service, prisma } = setup()
    prisma.album.findUnique.mockResolvedValue({ userId: 'me' })
    prisma.file.updateMany.mockResolvedValue({ count: 1 })
    await service.assignAlbumMedia(user('me'), 'al1', { fileIds: ['f1'] })
    const arg = prisma.file.updateMany.mock.calls[0][0]
    expect(arg.where).toMatchObject({ ownerId: 'me', bucket: 'profile-media' })
    expect(arg.data).toEqual({ albumId: 'al1' })
  })

  it('обложкой можно назначить только фото из этого альбома', async () => {
    const { service, prisma } = setup()
    prisma.album.findUnique.mockResolvedValue({ userId: 'me' })
    prisma.file.findFirst.mockResolvedValue(null)
    const err = await service.updateAlbum(user('me'), 'al1', { coverFileId: 'fX' }).catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
  })
})

describe('ProfileContentService — видимость контента профиля (§14.7)', () => {
  it('закрытый профиль не отдаёт медиа чужому смотрящему', async () => {
    const { service, prisma, users } = setup()
    users.canViewProfileContent.mockResolvedValue(false)

    const list = await service.listMedia(user('stranger'), 'owner')

    expect(list).toEqual([])
    // До запроса в БД дело не доходит — иначе чужие фото утекли бы вместе с ответом.
    expect(prisma.file.findMany).not.toHaveBeenCalled()
  })

  it('закрытый профиль не отдаёт альбомы чужому смотрящему', async () => {
    const { service, prisma, users } = setup()
    users.canViewProfileContent.mockResolvedValue(false)

    const list = await service.listAlbums(user('stranger'), 'owner')

    expect(list).toEqual([])
    expect(prisma.album.findMany).not.toHaveBeenCalled()
  })

  it('открытый профиль отдаёт медиа как прежде', async () => {
    const { service, prisma, users } = setup()
    prisma.file.findMany.mockResolvedValue([file()])

    const list = await service.listMedia(user('friend'), 'owner')

    expect(list).toHaveLength(1)
    expect(users.canViewProfileContent).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'friend' }),
      'owner',
    )
  })
})

// Статьи закрытого профиля отдавались по прямому запросу, хотя «визитка» владельца была закрыта.
describe('ProfileContentService — статьи и закрытый профиль (§14.7)', () => {
  const stranger: JwtPayload = {
    sub: 'stranger',
    role: Role.EMPLOYER,
    universityId: null,
    facultyId: null,
    groupId: null,
  }

  it('статьи закрытого профиля списком не отдаются — до запроса статей', async () => {
    const { service, prisma, users } = setup()
    prisma.user.findUnique.mockResolvedValue(owner('owner'))
    users.canViewProfileContentOf.mockResolvedValue(false)

    expect(await service.listArticles(stranger, 'owner')).toEqual([])
    expect(prisma.profileArticle.findMany).not.toHaveBeenCalled()
  })

  it('открытый профиль — прежний фильтр: опубликованные, visibility по scope', async () => {
    const { service, prisma } = setup()
    prisma.user.findUnique.mockResolvedValue(owner('owner'))
    prisma.profileArticle.findMany.mockResolvedValue([])

    await service.listArticles(user('peer'), 'owner')
    expect(prisma.profileArticle.findMany.mock.calls[0][0].where).toEqual({
      userId: 'owner',
      status: 'PUBLISHED',
      visibility: { in: ['ALL', 'UNIVERSITY', 'FACULTY', 'GROUP'] },
    })
  })

  it('читалка, комментарии, закладка и просмотр статьи закрытого профиля → NOT_FOUND', async () => {
    const { service, prisma, users } = setup()
    prisma.profileArticle.findUnique.mockResolvedValue({
      userId: 'owner',
      status: 'PUBLISHED',
      visibility: 'ALL',
      user: owner('owner'),
    })
    users.canViewProfileContentOf.mockResolvedValue(false)

    for (const call of [
      () => service.listArticleComments(stranger, 'a1'),
      () => service.addArticleComment(stranger, 'a1', { content: 'x' }),
      () => service.toggleBookmark(stranger, 'a1'),
      () => service.incrementArticleView(stranger, 'a1'),
    ]) {
      const err = await call().catch((e) => e)
      expect(err.code).toBe('NOT_FOUND')
    }
    expect(prisma.contentComment.findMany).not.toHaveBeenCalled()
    expect(prisma.contentComment.create).not.toHaveBeenCalled()
    expect(prisma.bookmark.create).not.toHaveBeenCalled()
    expect(prisma.profileArticle.update).not.toHaveBeenCalled()
  })

  it('закладки отдают только статьи, видимые сейчас, и без полей автора', async () => {
    const { service, prisma, users } = setup()
    const article = (id: string, author: ReturnType<typeof owner>, over = {}) => ({
      id,
      userId: author.id,
      status: 'PUBLISHED',
      visibility: 'ALL',
      _count: { comments: 0, bookmarks: 1 },
      user: author,
      ...over,
    })
    prisma.bookmark.findMany.mockResolvedValueOnce([
      { article: article('ok', owner('open')) },
      { article: article('closed', owner('closed')) },
      { article: article('draft', owner('open'), { status: 'DRAFT' }) },
      {
        article: article('other-uni', owner('open', { universityId: 'x' }), {
          visibility: 'UNIVERSITY',
        }),
      },
    ])
    users.viewableProfileContentOwners.mockResolvedValue(new Set(['open']))

    const list = await service.listBookmarks(user('me'))

    expect(list.map((a) => a.id)).toEqual(['ok'])
    expect(list[0]).not.toHaveProperty('user')
  })
})

// E-F08: контент профиля снимает модератор — по правилам постов: роль строго выше автора,
// scope (вуз/факультет автора) — из JWT модератора и записи автора, а не из запроса.
describe('ProfileContentService — снятие модератором (E-F08)', () => {
  const mod = (role: Role, scope: Partial<JwtPayload> = {}): JwtPayload => ({
    sub: 'mod',
    role,
    universityId: scope.universityId ?? null,
    facultyId: scope.facultyId ?? null,
    groupId: null,
  })
  const author = (over: Record<string, unknown> = {}) => ({
    role: Role.STUDENT,
    universityId: 'u',
    facultyId: 'f',
    ...over,
  })

  it('модератор вуза снимает статью студента своего вуза — с записью в аудит', async () => {
    const { service, prisma, audit } = setup()
    prisma.profileArticle.findUnique.mockResolvedValue({ userId: 'stud', user: author() })
    await service.deleteArticle(mod(Role.UNIVERSITY_MODERATOR, { universityId: 'u' }), 'a1', ctx)
    expect(prisma.profileArticle.delete).toHaveBeenCalledWith({ where: { id: 'a1' } })
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'mod',
        action: 'profile_article_deleted',
        entityId: 'a1',
        metadata: { authorId: 'stud' },
        ip: '127.0.0.1',
      }),
    )
  })

  it('владелец удаляет свою статью без записи в аудит', async () => {
    const { service, prisma, audit } = setup()
    prisma.profileArticle.findUnique.mockResolvedValue({ userId: 'me', user: author() })
    await service.deleteArticle(user('me'), 'a1', ctx)
    expect(prisma.profileArticle.delete).toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('модератор вуза: статья автора другого вуза → WRONG_SCOPE, не удаляется', async () => {
    const { service, prisma } = setup()
    prisma.profileArticle.findUnique.mockResolvedValue({
      userId: 'stud',
      user: author({ universityId: 'other' }),
    })
    const err = await service
      .deleteArticle(mod(Role.UNIVERSITY_ADMIN, { universityId: 'u' }), 'a1', ctx)
      .catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
    expect(prisma.profileArticle.delete).not.toHaveBeenCalled()
  })

  it('роль не выше автора → FORBIDDEN (модератор вуза не снимает статью админа вуза)', async () => {
    const { service, prisma } = setup()
    prisma.profileArticle.findUnique.mockResolvedValue({
      userId: 'adm',
      user: author({ role: Role.UNIVERSITY_ADMIN }),
    })
    const err = await service
      .deleteArticle(mod(Role.UNIVERSITY_MODERATOR, { universityId: 'u' }), 'a1', ctx)
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.profileArticle.delete).not.toHaveBeenCalled()
  })

  it('чужую статью не снимают роли без модерации (преподаватель выше студента — всё равно нет)', async () => {
    const { service, prisma } = setup()
    prisma.profileArticle.findUnique.mockResolvedValue({ userId: 'stud', user: author() })
    for (const role of [Role.TEACHER, Role.STAROSTA, Role.STUDENT, Role.EMPLOYER]) {
      const err = await service
        .deleteArticle(mod(role, { universityId: 'u', facultyId: 'f' }), 'a1', ctx)
        .catch((e) => e)
      expect(err.code).toBe('FORBIDDEN')
    }
    expect(prisma.profileArticle.delete).not.toHaveBeenCalled()
  })

  it('декан снимает только авторов своего факультета', async () => {
    const { service, prisma } = setup()
    prisma.profileArticle.findUnique.mockResolvedValue({
      userId: 'stud',
      user: author({ facultyId: 'f2' }),
    })
    const err = await service
      .deleteArticle(mod(Role.DEAN, { universityId: 'u', facultyId: 'f' }), 'a1', ctx)
      .catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')

    prisma.profileArticle.findUnique.mockResolvedValue({ userId: 'stud', user: author() })
    await service.deleteArticle(mod(Role.DEAN, { universityId: 'u', facultyId: 'f' }), 'a1', ctx)
    expect(prisma.profileArticle.delete).toHaveBeenCalledTimes(1)
  })

  it('модератор платформы снимает статью в любом вузе', async () => {
    const { service, prisma } = setup()
    prisma.profileArticle.findUnique.mockResolvedValue({
      userId: 'adm',
      user: author({ role: Role.UNIVERSITY_ADMIN, universityId: 'any' }),
    })
    await service.deleteArticle(mod(Role.PLATFORM_MODERATOR), 'a1', ctx)
    expect(prisma.profileArticle.delete).toHaveBeenCalled()
  })

  it('медиа: модератор снимает файл вместе с обложкой видео и объектом в MinIO', async () => {
    const { service, prisma, files, audit } = setup()
    files.findOrThrow.mockResolvedValue(
      file({ ownerId: 'stud', mime: 'video/mp4', posterKey: 'p.jpg' }),
    )
    prisma.user.findUnique.mockResolvedValue(author())
    await service.deleteMedia(mod(Role.UNIVERSITY_MODERATOR, { universityId: 'u' }), 'file1', ctx)
    expect(files.removeRawObject).toHaveBeenCalledWith('profile-covers', 'p.jpg')
    // Владелец не сверяется FileService-ом: право модератора проверено в сервисе.
    expect(files.delete).toHaveBeenCalledWith('file1', undefined)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'profile_media_deleted', metadata: { authorId: 'stud' } }),
    )
  })

  it('медиа: модератор вне scope → WRONG_SCOPE, файл цел', async () => {
    const { service, prisma, files } = setup()
    files.findOrThrow.mockResolvedValue(file({ ownerId: 'stud' }))
    prisma.user.findUnique.mockResolvedValue(author({ universityId: 'other' }))
    const err = await service
      .deleteMedia(mod(Role.UNIVERSITY_MODERATOR, { universityId: 'u' }), 'file1', ctx)
      .catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
    expect(files.delete).not.toHaveBeenCalled()
  })

  it('медиа: модератор не снимает файл из чужого бакета (аватар) — NOT_FOUND', async () => {
    const { service, files } = setup()
    files.findOrThrow.mockResolvedValue(file({ ownerId: 'stud', bucket: 'avatars' }))
    const err = await service.deleteMedia(mod(Role.PLATFORM_ADMIN), 'file1', ctx).catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(files.delete).not.toHaveBeenCalled()
  })

  it('комментарий: модератор вуза снимает комментарий гостя под статьёй своего студента', async () => {
    const { service, prisma, audit } = setup()
    prisma.contentComment.findUnique.mockResolvedValue({
      authorId: 'guest',
      articleId: 'a1',
      author: author({ universityId: 'other' }),
      article: { userId: 'stud', user: author() },
    })
    await service.deleteArticleComment(
      mod(Role.UNIVERSITY_MODERATOR, { universityId: 'u' }),
      'a1',
      'c1',
      ctx,
    )
    expect(prisma.contentComment.delete).toHaveBeenCalledWith({ where: { id: 'c1' } })
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'content_comment_deleted',
        metadata: { articleId: 'a1', authorId: 'guest' },
      }),
    )
  })

  it('комментарий: ранг сверяется с автором комментария, а не статьи', async () => {
    const { service, prisma } = setup()
    prisma.contentComment.findUnique.mockResolvedValue({
      authorId: 'dean',
      articleId: 'a1',
      author: author({ role: Role.DEAN }),
      article: { userId: 'stud', user: author() },
    })
    const err = await service
      .deleteArticleComment(mod(Role.DEAN, { universityId: 'u', facultyId: 'f' }), 'a1', 'c1', ctx)
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.contentComment.delete).not.toHaveBeenCalled()
  })

  it('комментарий: владелец статьи удаляет чужой комментарий без аудита, посторонний — нет', async () => {
    const { service, prisma, audit } = setup()
    prisma.contentComment.findUnique.mockResolvedValue({
      authorId: 'guest',
      articleId: 'a1',
      author: author(),
      article: { userId: 'me', user: author() },
    })
    await service.deleteArticleComment(user('me'), 'a1', 'c1', ctx)
    expect(prisma.contentComment.delete).toHaveBeenCalledTimes(1)
    expect(audit.record).not.toHaveBeenCalled()

    const err = await service
      .deleteArticleComment(user('stranger'), 'a1', 'c1', ctx)
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.contentComment.delete).toHaveBeenCalledTimes(1)
  })
})

describe('ProfileContentService — статьи: плитки без текста, читалка, просмотры, закладки', () => {
  const visibleArticle = {
    userId: 'owner',
    status: 'PUBLISHED',
    visibility: 'ALL',
    user: owner('owner'),
  }
  const reader = user('reader')

  it('view=card — выборка без полного текста; без параметра — с текстом, как раньше', async () => {
    const { service, prisma } = setup()
    prisma.user.findUnique.mockResolvedValue(owner('owner'))
    prisma.profileArticle.findMany.mockResolvedValue([])

    await service.listArticles(reader, 'owner', { view: 'card' })
    expect(prisma.profileArticle.findMany.mock.calls[0][0].select.content).toBeUndefined()
    expect(prisma.profileArticle.findMany.mock.calls[0][0].select.title).toBe(true)

    await service.listArticles(reader, 'owner')
    expect(prisma.profileArticle.findMany.mock.calls[1][0].select.content).toBe(true)
  })

  it('статья целиком — по той же видимости; невидимая → NOT_FOUND', async () => {
    const { service, prisma, users } = setup()
    prisma.profileArticle.findUnique.mockResolvedValueOnce(visibleArticle).mockResolvedValueOnce({
      id: 'a1',
      content: 'полный текст',
      _count: { comments: 2, bookmarks: 1 },
    })
    const article = await service.getArticle(reader, 'a1')
    expect(article).toMatchObject({ id: 'a1', content: 'полный текст', commentCount: 2 })

    prisma.profileArticle.findUnique.mockResolvedValue(visibleArticle)
    users.canViewProfileContentOf.mockResolvedValue(false)
    const err = await service.getArticle(reader, 'a1').catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })

  it('повторный просмотр за сутки не пишет в строку статьи', async () => {
    const { service, prisma, redisMulti } = setup()
    prisma.profileArticle.findUnique
      .mockResolvedValueOnce(visibleArticle)
      .mockResolvedValueOnce({ views: 12 })
    redisMulti.exec.mockResolvedValue([
      [null, 0],
      [null, 1],
    ])
    await expect(service.incrementArticleView(reader, 'a1')).resolves.toEqual({ views: 12 })
    expect(redisMulti.sadd).toHaveBeenCalledWith(
      expect.stringMatching(/^views:article:a1:/),
      'reader',
    )
    expect(prisma.profileArticle.update).not.toHaveBeenCalled()
  })

  it('закладка: снятие без чтения перед записью; гонка двух create → «сохранено», не 409', async () => {
    const { service, prisma } = setup()
    prisma.profileArticle.findUnique.mockResolvedValue(visibleArticle)

    prisma.bookmark.deleteMany.mockResolvedValueOnce({ count: 1 })
    await expect(service.toggleBookmark(reader, 'a1')).resolves.toEqual({ bookmarked: false })
    expect(prisma.bookmark.create).not.toHaveBeenCalled()

    prisma.bookmark.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
    )
    await expect(service.toggleBookmark(reader, 'a1')).resolves.toEqual({ bookmarked: true })
  })
})

describe('ProfileContentService — комментарии статьи: страницы и уведомление автору', () => {
  const visibleArticle = {
    userId: 'owner',
    status: 'PUBLISHED',
    visibility: 'ALL',
    user: owner('owner'),
  }
  const reader = user('reader')
  const comment = (id: string) => ({
    id,
    content: 'x',
    createdAt: new Date(),
    authorId: 'reader',
    author: { id: 'reader', firstName: 'Аня', lastName: 'Ким', avatarUrl: null },
  })

  it('без limit/cursor — массив последних двухсот по порядку написания', async () => {
    const { service, prisma } = setup()
    prisma.profileArticle.findUnique.mockResolvedValue(visibleArticle)
    prisma.contentComment.findMany.mockResolvedValue([comment('c2'), comment('c1')])

    const res = await service.listArticleComments(reader, 'a1')
    expect((res as Array<{ id: string }>).map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(prisma.contentComment.findMany.mock.calls[0][0]).toMatchObject({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    })
  })

  it('с limit — страница свежих сверху с курсором и total', async () => {
    const { service, prisma } = setup()
    prisma.profileArticle.findUnique.mockResolvedValue(visibleArticle)
    prisma.contentComment.findMany.mockResolvedValue([
      { ...comment('c3'), createdAt: new Date(3000) },
      { ...comment('c2'), createdAt: new Date(2000) },
    ])
    prisma.contentComment.count.mockResolvedValue(3)

    const res = await service.listArticleComments(reader, 'a1', { limit: 1 })
    expect(res).toBeInstanceOf(Paginated)
    expect((res as Paginated<{ id: string }>).meta).toEqual({
      cursor: '3000.c3',
      hasNext: true,
      total: 3,
    })
  })

  it('курсор на стёртый навсегда комментарий не обрывает листание', async () => {
    const { service, prisma } = setup()
    prisma.profileArticle.findUnique.mockResolvedValue(visibleArticle)
    prisma.contentComment.findMany.mockResolvedValue([])

    await service.listArticleComments(reader, 'a1', { limit: 10, cursor: '3000.c3' })
    // Позиция берётся из курсора — строку c3 искать не нужно (её уже может не быть).
    expect(prisma.contentComment.findUnique).not.toHaveBeenCalled()
    expect(prisma.contentComment.findMany.mock.calls[0][0].where).toEqual({
      AND: [
        { articleId: 'a1' },
        {
          OR: [
            { createdAt: { lt: new Date(3000) } },
            { createdAt: new Date(3000), id: { lt: 'c3' } },
          ],
        },
      ],
    })
  })

  it('новый комментарий — автору статьи свёрнутое уведомление; свой и при блокировке — нет', async () => {
    const { service, prisma, queue } = setup()
    prisma.profileArticle.findUnique
      .mockResolvedValueOnce(visibleArticle)
      .mockResolvedValueOnce({ allowComments: true, userId: 'owner' })
    prisma.contentComment.create.mockResolvedValue(comment('c1'))

    await service.addArticleComment(reader, 'a1', { content: 'x' })
    expect(queue.enqueue).toHaveBeenCalledWith(
      'notifications',
      'comment-added',
      expect.objectContaining({
        recipientIds: ['owner'],
        type: 'POST',
        bodyKey: 'comments.article.body',
        params: { name: 'Аня Ким' },
        data: { articleId: 'a1', commentId: 'c1', url: '/profile/owner' },
        dedupeKey: 'article-comment:c1',
        collapseKey: 'article-comments:a1',
      }),
      { jobId: 'article-comment:c1' },
    )

    queue.enqueue.mockClear()
    prisma.profileArticle.findUnique
      .mockResolvedValueOnce(visibleArticle)
      .mockResolvedValueOnce({ allowComments: true, userId: 'owner' })
    prisma.userBlock.findFirst.mockResolvedValueOnce({ id: 'blk' })
    await service.addArticleComment(reader, 'a1', { content: 'x' })
    expect(queue.enqueue).not.toHaveBeenCalled()

    prisma.profileArticle.findUnique
      .mockResolvedValueOnce({ ...visibleArticle, userId: 'reader' })
      .mockResolvedValueOnce({ allowComments: true, userId: 'reader' })
    await service.addArticleComment(reader, 'a1', { content: 'x' })
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})

describe('ProfileContentService — итоги вкладок профиля (E-F25)', () => {
  const author = {
    id: 'author',
    role: Role.STUDENT,
    profileVisibility: 'PUBLIC',
    universityId: 'u',
    facultyId: 'f',
    groupId: 'g',
    deletedAt: null,
  }

  it('считает без потолка списков: фото = медиа минус видео, статьи по видимости', async () => {
    const { service, prisma, polls } = setup()
    prisma.user.findUnique.mockResolvedValue(author)
    prisma.file.count.mockImplementation(async (args: { where: { mime?: unknown } }) =>
      args.where.mime ? 120 : 1000,
    )
    prisma.profileArticle.count.mockResolvedValue(150)
    polls.countVisibleByUser.mockResolvedValue(130)

    const res = await service.counts(user('viewer'), 'author')

    expect(res).toEqual({ photos: 880, videos: 120, articles: 150, polls: 130 })
    expect(prisma.file.count).toHaveBeenCalledWith({
      where: { ownerId: 'author', bucket: 'profile-media', mime: { startsWith: 'video/' } },
    })
    // Чужие статьи — только опубликованные и в доступной смотрящему области.
    const articleWhere = prisma.profileArticle.count.mock.calls[0][0].where
    expect(articleWhere).toMatchObject({ userId: 'author', status: 'PUBLISHED' })
    expect(polls.countVisibleByUser).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'viewer' }),
      author,
    )
  })

  it('закрытый для смотрящего профиль — нули, ничего не считается', async () => {
    const { service, prisma, users, polls } = setup()
    prisma.user.findUnique.mockResolvedValue(author)
    users.canViewProfileContentOf.mockResolvedValue(false)

    await expect(service.counts(user('viewer'), 'author')).resolves.toEqual({
      photos: 0,
      videos: 0,
      articles: 0,
      polls: 0,
    })
    expect(prisma.file.count).not.toHaveBeenCalled()
    expect(polls.countVisibleByUser).not.toHaveBeenCalled()
  })

  it('нет пользователя — нули', async () => {
    const { service, prisma } = setup()
    prisma.user.findUnique.mockResolvedValue(null)
    await expect(service.counts(user('viewer'), 'nope')).resolves.toEqual({
      photos: 0,
      videos: 0,
      articles: 0,
      polls: 0,
    })
  })
})
