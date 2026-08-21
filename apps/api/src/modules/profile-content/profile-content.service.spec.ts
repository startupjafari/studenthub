import { ConfigService } from '@nestjs/config'
import { Role } from '@studenthub/shared-types'
import { PrismaService } from '../../common/prisma/prisma.service'
import { FileService } from '../files/file.service'
import { UserService } from '../users/users.service'
import type { EnvVars } from '../../config/env.schema'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { ProfileContentService } from './profile-content.service'

function user(sub: string): JwtPayload {
  return { sub, role: Role.STUDENT, universityId: 'u', facultyId: 'f', groupId: 'g' }
}

const CONFIG: Record<string, unknown> = {
  MINIO_BUCKET_PROFILE_MEDIA: 'profile-media',
  MINIO_USE_SSL: false,
  MINIO_ENDPOINT: 'localhost',
  MINIO_PORT: 9000,
}

function setup() {
  const prisma = {
    profileArticle: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    album: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    file: { findFirst: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
    bookmark: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    contentComment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
  }
  const files = {
    upload: jest.fn(),
    delete: jest.fn(),
    findOrThrow: jest.fn(),
    listByOwnerAndBucket: jest.fn(),
    presignPut: jest.fn(),
    confirmDirectUpload: jest.fn(),
  }
  const config = { get: (k: string) => CONFIG[k] }
  // По умолчанию профиль открыт смотрящему; закрытый проверяется отдельным тестом.
  const users = { canViewProfileContent: jest.fn().mockResolvedValue(true) }
  const service = new ProfileContentService(
    prisma as unknown as PrismaService,
    files as unknown as FileService,
    config as unknown as ConfigService<EnvVars, true>,
    users as unknown as UserService,
  )
  return { service, prisma, files, users }
}

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
    const err = await service.deleteMedia(user('me'), 'file1').catch((e) => e)
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
    const err = await service.deleteArticle(user('me'), 'a1').catch((e) => e)
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
