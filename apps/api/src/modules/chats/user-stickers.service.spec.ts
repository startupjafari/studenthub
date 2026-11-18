import { MediaStatus, Prisma, StickerSetKind } from '@prisma/client'
import sharp from 'sharp'
import { USER_STICKER_LIMITS } from '@studenthub/shared-schemas'
import { MEDIA_JOBS, QUEUES } from '../../common/queue'
import type { PrismaService } from '../../common/prisma/prisma.service'
import { ChatStickersService } from './chat-stickers.service'
import { UserStickersService, randomStickerSlug } from './user-stickers.service'

function setup() {
  const prisma = {
    stickerSet: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'set1' }),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'set1',
        title: 'Коты',
        slug: 'uabc',
        removedAt: null,
        createdAt: new Date(),
        stickers: [],
      }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    sticker: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'st-new' }),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    userStickerSet: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    file: { findUnique: jest.fn() },
    chatMember: { findUnique: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  }
  const files = {
    getPresignedUrls: jest.fn().mockResolvedValue(new Map()),
    upload: jest.fn().mockResolvedValue({ id: 'file-new' }),
    delete: jest.fn().mockResolvedValue(undefined),
    getObjectBuffer: jest.fn(),
  }
  const catalog = new ChatStickersService(
    prisma as unknown as PrismaService,
    files as never,
    {} as never,
    {} as never,
    {} as never,
    { emitToUser: jest.fn() } as never,
  )
  const queue = { enqueue: jest.fn().mockResolvedValue(true) }
  const realtime = { emitToUser: jest.fn() }
  const config = { get: jest.fn().mockReturnValue('chat-bucket') }
  const minio = {
    putObject: jest.fn().mockResolvedValue({}),
    removeObject: jest.fn().mockResolvedValue(undefined),
    getPartialObject: jest.fn(),
  }
  const service = new UserStickersService(
    prisma as unknown as PrismaService,
    files as never,
    catalog,
    queue as never,
    config as never,
    realtime as never,
    minio as never,
  )
  return { service, prisma, files, queue, realtime, minio }
}

async function png(width = 64, height = 32): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: '#3a6f' } })
    .png()
    .toBuffer()
}

describe('randomStickerSlug', () => {
  it('годится и под правило коротких имён каталога, и в ссылку', () => {
    for (let i = 0; i < 50; i++) expect(randomStickerSlug()).toMatch(/^u[a-z0-9]{10}$/)
  })
})

describe('Свои наборы: создание и лимиты', () => {
  it('новый набор — USER, случайное короткое имя, сразу в панели владельца', async () => {
    const { service, prisma, realtime } = setup()
    await service.createMine('u1', { title: 'Коты' })
    const data = prisma.stickerSet.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      kind: StickerSetKind.USER,
      title: 'Коты',
      createdById: 'u1',
      addedBy: { create: { userId: 'u1' } },
    })
    expect(data.slug).toMatch(/^u[a-z0-9]{10}$/)
    expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'stickers:sets-changed', {})
  })

  it('совпало короткое имя — пробует другое', async () => {
    const { service, prisma } = setup()
    prisma.stickerSet.create
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      )
      .mockResolvedValueOnce({ id: 'set1' })
    await service.createMine('u1', { title: 'Коты' })
    expect(prisma.stickerSet.create).toHaveBeenCalledTimes(2)
  })

  it('своих наборов уже 10 — STICKER_LIMIT_REACHED (sets)', async () => {
    const { service, prisma } = setup()
    prisma.stickerSet.count.mockResolvedValue(USER_STICKER_LIMITS.SETS_PER_USER)
    await expect(service.createMine('u1', { title: 'x' })).rejects.toMatchObject({
      code: 'STICKER_LIMIT_REACHED',
      details: [expect.objectContaining({ field: 'sets' })],
    })
    expect(prisma.stickerSet.create).not.toHaveBeenCalled()
  })

  it('в панели уже 50 наборов — STICKER_LIMIT_REACHED (added)', async () => {
    const { service, prisma } = setup()
    prisma.userStickerSet.count.mockResolvedValue(USER_STICKER_LIMITS.ADDED_SETS_MAX)
    await expect(service.createMine('u1', { title: 'x' })).rejects.toMatchObject({
      code: 'STICKER_LIMIT_REACHED',
      details: [expect.objectContaining({ field: 'added' })],
    })
  })
})

describe('Свои наборы: владение', () => {
  it('чужой набор — NOT_FOUND (владелец только из JWT)', async () => {
    const { service, prisma } = setup()
    prisma.stickerSet.findFirst.mockResolvedValue(null)
    await expect(service.renameMine('u2', 'set1', { title: 'Мои' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(prisma.stickerSet.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'set1',
      kind: StickerSetKind.USER,
      createdById: 'u2',
      deletedAt: null,
    })
    expect(prisma.stickerSet.update).not.toHaveBeenCalled()
  })

  it('снятый модерацией набор нельзя пополнять', async () => {
    const { service, prisma } = setup()
    prisma.stickerSet.findFirst.mockResolvedValue({ removedAt: new Date() })
    await expect(
      service.addSticker('u1', 'set1', { file: { buffer: await png() }, fields: {} }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('удаление мягкое: набор помечен, у добавивших пропадает', async () => {
    const { service, prisma } = setup()
    prisma.stickerSet.findFirst.mockResolvedValue({ removedAt: null })
    await service.deleteMine('u1', 'set1')
    expect(prisma.stickerSet.update).toHaveBeenCalledWith({
      where: { id: 'set1' },
      data: { deletedAt: expect.any(Date) },
    })
    expect(prisma.userStickerSet.deleteMany).toHaveBeenCalledWith({ where: { setId: 'set1' } })
  })
})

describe('Добавление стикера', () => {
  it('картинка: сразу WebP 512 и READY', async () => {
    const { service, prisma, files, queue } = setup()
    prisma.stickerSet.findFirst.mockResolvedValue({ removedAt: null })
    await service.addSticker('u1', 'set1', {
      file: { buffer: await png() },
      fields: { emoji: '😺' },
    })
    const uploaded = files.upload.mock.calls[0][0]
    expect(uploaded).toMatchObject({
      bucket: 'chat-bucket',
      ownerId: 'u1',
      expectedCategory: 'IMAGE',
    })
    const meta = await sharp(uploaded.buffer).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(512)
    expect(prisma.sticker.create.mock.calls[0][0].data).toMatchObject({
      setId: 'set1',
      fileId: 'file-new',
      emoji: '😺',
      status: MediaStatus.READY,
      animated: false,
      width: 512,
      height: 256,
    })
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('GIF: временная копия, PROCESSING и job build-sticker в media-video', async () => {
    const { service, prisma, queue, minio } = setup()
    prisma.stickerSet.findFirst.mockResolvedValue({ removedAt: null })
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#f00' } })
      .gif()
      .toBuffer()
    await service.addSticker('u1', 'set1', {
      file: { buffer: gif },
      overlay: await png(),
      fields: { startMs: 500, durationMs: 2000, cropX: 0, cropY: 0, cropW: 1, cropH: 0.5 },
    })
    expect(minio.putObject).toHaveBeenCalledTimes(2)
    expect(prisma.sticker.create.mock.calls[0][0].data).toMatchObject({
      setId: 'set1',
      status: MediaStatus.PROCESSING,
      animated: true,
    })
    const [queueName, job, data, opts] = queue.enqueue.mock.calls[0]
    expect(queueName).toBe(QUEUES.MEDIA_VIDEO)
    expect(job).toBe(MEDIA_JOBS.STICKER)
    expect(data).toMatchObject({
      stickerId: 'st-new',
      ownerId: 'u1',
      sourceBucket: 'chat-bucket',
      sourceTemp: '1',
      kind: 'gif',
      startMs: '500',
      durationMs: '2000',
      crop: '0,0,1,0.5',
      overlayKey: expect.stringMatching(/^sticker-src\//),
    })
    expect(opts).toMatchObject({ jobId: 'sticker_st-new', attempts: 2 })
  })

  it('очередь недоступна — стикер FAILED, временные объекты убраны', async () => {
    const { service, prisma, queue, minio } = setup()
    prisma.stickerSet.findFirst.mockResolvedValue({ removedAt: null })
    queue.enqueue.mockResolvedValue(false)
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#f00' } })
      .gif()
      .toBuffer()
    await service.addSticker('u1', 'set1', { file: { buffer: gif }, fields: {} })
    expect(prisma.sticker.update).toHaveBeenCalledWith({
      where: { id: 'st-new' },
      data: { status: MediaStatus.FAILED },
    })
    expect(minio.removeObject).toHaveBeenCalled()
  })

  it('в наборе уже 120 — STICKER_LIMIT_REACHED (stickers)', async () => {
    const { service, prisma } = setup()
    prisma.stickerSet.findFirst.mockResolvedValue({ removedAt: null })
    prisma.sticker.count.mockResolvedValue(USER_STICKER_LIMITS.STICKERS_PER_SET)
    await expect(
      service.addSticker('u1', 'set1', { file: { buffer: await png() }, fields: {} }),
    ).rejects.toMatchObject({ code: 'STICKER_LIMIT_REACHED' })
  })

  it('не картинка и не видео — STICKER_SOURCE_INVALID', async () => {
    const { service, prisma } = setup()
    prisma.stickerSet.findFirst.mockResolvedValue({ removedAt: null })
    await expect(
      service.addSticker('u1', 'set1', {
        file: { buffer: Buffer.from('%PDF-1.7 definitely not an image') },
        fields: {},
      }),
    ).rejects.toMatchObject({ code: 'STICKER_SOURCE_INVALID' })
  })

  it('вложение чужого чата — NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.stickerSet.findFirst.mockResolvedValue({ removedAt: null })
    prisma.file.findUnique.mockResolvedValue({
      bucket: 'chat-bucket',
      key: 'k',
      size: 100,
      ownerId: 'u9',
      message: { chatId: 'c1', deletedAt: null },
    })
    prisma.chatMember.findUnique.mockResolvedValue(null)
    await expect(
      service.addSticker('u1', 'set1', { fields: { sourceFileId: 'f1' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('видео из переписки участника — без копии, ffmpeg читает вложение', async () => {
    const { service, prisma, queue, minio } = setup()
    prisma.stickerSet.findFirst.mockResolvedValue({ removedAt: null })
    prisma.file.findUnique.mockResolvedValue({
      bucket: 'chat-bucket',
      key: 'video.mp4',
      size: 300 * 1024 * 1024,
      ownerId: 'u9',
      message: { chatId: 'c1', deletedAt: null },
    })
    prisma.chatMember.findUnique.mockResolvedValue({ bannedAt: null })
    const head = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypisom'),
      Buffer.alloc(52),
    ])
    minio.getPartialObject.mockResolvedValue([head])
    await service.addSticker('u1', 'set1', { fields: { sourceFileId: 'f1' } })
    expect(minio.putObject).not.toHaveBeenCalled()
    expect(queue.enqueue.mock.calls[0][2]).toMatchObject({
      sourceBucket: 'chat-bucket',
      sourceKey: 'video.mp4',
      kind: 'video',
    })
    expect(queue.enqueue.mock.calls[0][2].sourceTemp).toBeUndefined()
  })
})

describe('Удаление и порядок стикеров', () => {
  it('готовый стикер убирается мягко — отправленные остаются видимыми', async () => {
    const { service, prisma, files } = setup()
    prisma.stickerSet.findFirst.mockResolvedValue({ removedAt: null })
    prisma.sticker.findFirst.mockResolvedValue({ id: 'st1', status: 'READY', fileId: 'f1' })
    await service.deleteSticker('u1', 'set1', 'st1')
    expect(prisma.sticker.update).toHaveBeenCalledWith({
      where: { id: 'st1' },
      data: { deletedAt: expect.any(Date) },
    })
    expect(files.delete).not.toHaveBeenCalled()
  })

  it('порядок обязан перечислить все живые стикеры', async () => {
    const { service, prisma } = setup()
    prisma.stickerSet.findFirst.mockResolvedValue({ removedAt: null })
    prisma.sticker.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    await expect(service.reorder('u1', 'set1', { stickerIds: ['a'] })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    await service.reorder('u1', 'set1', { stickerIds: ['b', 'a'] })
    expect(prisma.sticker.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: { order: 0 } })
    expect(prisma.sticker.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { order: 1 } })
  })
})

describe('Панель и превью', () => {
  it('добавить можно только живой личный набор; сверх 50 — лимит', async () => {
    const { service, prisma } = setup()
    prisma.stickerSet.findFirst.mockResolvedValueOnce(null)
    await expect(service.addSet('u1', 'gone')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(prisma.stickerSet.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'gone',
      kind: StickerSetKind.USER,
      deletedAt: null,
      removedAt: null,
    })
    prisma.stickerSet.findFirst.mockResolvedValue({ id: 'set1' })
    prisma.userStickerSet.count.mockResolvedValue(USER_STICKER_LIMITS.ADDED_SETS_MAX)
    await expect(service.addSet('u1', 'set1')).rejects.toMatchObject({
      code: 'STICKER_LIMIT_REACHED',
    })
    prisma.userStickerSet.count.mockResolvedValue(3)
    await service.addSet('u1', 'set1')
    expect(prisma.userStickerSet.upsert).toHaveBeenCalled()
  })

  it('превью не раскрывает автора: только isMine; каталог всегда «добавлен»', async () => {
    const { service, prisma } = setup()
    prisma.stickerSet.findFirst.mockResolvedValue({
      id: 'set1',
      kind: StickerSetKind.USER,
      title: 'Коты',
      slug: 'uabc',
      createdById: 'u9',
      stickers: [],
      addedBy: [],
    })
    const dto = await service.preview('u1', { slug: 'uabc' })
    expect(dto).toEqual({
      id: 'set1',
      title: 'Коты',
      slug: 'uabc',
      kind: 'USER',
      isMine: false,
      isAdded: false,
      stickers: [],
    })
    expect(JSON.stringify(dto)).not.toContain('u9')

    prisma.stickerSet.findFirst.mockResolvedValue({
      id: 'cat',
      kind: StickerSetKind.CATALOG,
      title: 'Платформа',
      slug: 'base',
      createdById: 'admin',
      stickers: [],
      addedBy: [],
    })
    await expect(service.preview('u1', { setId: 'cat' })).resolves.toMatchObject({
      kind: 'CATALOG',
      isAdded: true,
      isMine: false,
    })
  })
})
