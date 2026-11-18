import { Readable } from 'node:stream'
import { MediaStatus } from '@prisma/client'
import sharp from 'sharp'
import type { PrismaService } from '../../common/prisma/prisma.service'
import { StickerProcessingService, type StickerJobData } from './sticker-processing.service'

function setup(status: MediaStatus | null = MediaStatus.PROCESSING) {
  const prisma = {
    sticker: {
      findUnique: jest.fn().mockResolvedValue(status ? { status } : null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    file: {
      create: jest.fn().mockResolvedValue({ id: 'file-out' }),
      delete: jest.fn().mockResolvedValue({}),
    },
  }
  const minio = {
    getObject: jest.fn(),
    putObject: jest.fn().mockResolvedValue({}),
    removeObject: jest.fn().mockResolvedValue(undefined),
    presignedGetObject: jest.fn(),
  }
  const config = {
    get: jest.fn((key: string) =>
      key === 'MEDIA_TMP_DIR' ? undefined : key === 'FFMPEG_PATH' ? 'ffmpeg' : 'ffprobe',
    ),
  }
  const service = new StickerProcessingService(
    prisma as unknown as PrismaService,
    config as never,
    minio as never,
  )
  return { service, prisma, minio }
}

const job: StickerJobData = {
  stickerId: 'st1',
  ownerId: 'u1',
  sourceBucket: 'chat',
  sourceKey: 'sticker-src/a',
  sourceTemp: '1',
  kind: 'webp',
  startMs: '0',
  durationMs: '3000',
}

async function animatedWebp(): Promise<Buffer> {
  const frames = await Promise.all(
    [0, 80, 160].map((r) =>
      sharp({
        create: { width: 32, height: 32, channels: 4, background: { r, g: 0, b: 0, alpha: 1 } },
      })
        .png()
        .toBuffer(),
    ),
  )
  return sharp(frames, { join: { animated: true } })
    .webp({ delay: [100, 100, 100], loop: 0 })
    .toBuffer()
}

describe('StickerProcessingService', () => {
  it('стикер уже не в работе — ничего не собирает, временное убирает', async () => {
    const { service, minio, prisma } = setup(MediaStatus.READY)
    await service.build(job)
    expect(minio.getObject).not.toHaveBeenCalled()
    expect(prisma.file.create).not.toHaveBeenCalled()
    expect(minio.removeObject).toHaveBeenCalledWith('chat', 'sticker-src/a')
  })

  it('исходник не годится — FAILED без повторов', async () => {
    const { service, minio, prisma } = setup()
    minio.getObject.mockResolvedValue(Readable.from([Buffer.from('RIFF....WEBPnot really')]))
    await expect(service.build(job)).resolves.toBeUndefined()
    expect(prisma.sticker.updateMany).toHaveBeenCalledWith({
      where: { id: 'st1', status: MediaStatus.PROCESSING },
      data: { status: MediaStatus.FAILED },
    })
    expect(prisma.file.create).not.toHaveBeenCalled()
  })

  it('готовый стикер: объект, File без вариантов и условный перевод в READY', async () => {
    const { service, minio, prisma } = setup()
    minio.getObject.mockResolvedValue(Readable.from([await animatedWebp()]))
    await service.build(job)
    expect(minio.putObject).toHaveBeenCalledWith(
      'chat',
      expect.stringMatching(/\.webp$/),
      expect.any(Buffer),
      expect.any(Number),
      { 'Content-Type': 'image/webp' },
    )
    expect(prisma.file.create.mock.calls[0][0].data).toMatchObject({
      mime: 'image/webp',
      ownerId: 'u1',
      mediaStatus: MediaStatus.NONE,
      width: 512,
      height: 512,
    })
    expect(prisma.sticker.updateMany).toHaveBeenCalledWith({
      where: { id: 'st1', status: MediaStatus.PROCESSING },
      data: expect.objectContaining({
        fileId: 'file-out',
        status: MediaStatus.READY,
        animated: true,
      }),
    })
  })

  it('стикер удалили во время сборки — свой файл убирается', async () => {
    const { service, minio, prisma } = setup()
    minio.getObject.mockResolvedValue(Readable.from([await animatedWebp()]))
    prisma.sticker.updateMany.mockResolvedValue({ count: 0 })
    await service.build(job)
    expect(prisma.file.delete).toHaveBeenCalledWith({ where: { id: 'file-out' } })
  })
})
