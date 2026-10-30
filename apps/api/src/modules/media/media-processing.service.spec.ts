import { Readable } from 'node:stream'
import { MediaStatus, MediaVariantKind, Prisma } from '@prisma/client'
import sharp from 'sharp'
import * as ffmpeg from './ffmpeg'
import { MediaProcessingService } from './media-processing.service'

type Mock = jest.Mock

const FILE_ID = '11111111-1111-4111-8111-111111111111'

function setup(file: Record<string, unknown> | null) {
  const tx: unknown[] = []
  const prisma = {
    file: {
      findUnique: jest.fn().mockResolvedValue(file) as Mock,
      findFirst: jest.fn().mockResolvedValue(null) as Mock,
      update: jest.fn((args: unknown) => ({ op: 'update', args })) as Mock,
      updateMany: jest.fn().mockResolvedValue({ count: 1 }) as Mock,
    },
    fileVariant: {
      deleteMany: jest.fn((args: unknown) => ({ op: 'deleteMany', args })) as Mock,
      createMany: jest.fn((args: unknown) => ({ op: 'createMany', args })) as Mock,
    },
    $transaction: jest.fn(async (ops: unknown[]) => {
      tx.push(...ops)
      return ops
    }) as Mock,
  }
  const minio = {
    getObject: jest.fn() as Mock,
    putObject: jest.fn().mockResolvedValue({}) as Mock,
    copyObject: jest.fn().mockResolvedValue({}) as Mock,
    listObjectsV2: jest.fn(() => Readable.from([])) as Mock,
    removeObjects: jest.fn().mockResolvedValue(undefined) as Mock,
    presignedGetObject: jest.fn().mockResolvedValue('http://minio/source') as Mock,
  }
  const config = {
    get: jest.fn((k: string) => ({ FFMPEG_PATH: 'ffmpeg', FFPROBE_PATH: 'ffprobe' })[k]),
  }
  const service = new MediaProcessingService(prisma as never, config as never, minio as never)
  return { service, prisma, minio, tx }
}

const imageFile = {
  id: FILE_ID,
  bucket: 'chat-media',
  key: 'u/photo.jpg',
  mime: 'image/jpeg',
  asDocument: false,
  mediaStatus: MediaStatus.PENDING,
}

async function photo(): Promise<Buffer> {
  return sharp({ create: { width: 1400, height: 1000, channels: 3, background: '#468' } })
    .jpeg()
    .toBuffer()
}

describe('MediaProcessingService.process — изображение', () => {
  it('заливает WebP-копии с вечным кешем и одной транзакцией ставит READY', async () => {
    const { service, prisma, minio, tx } = setup(imageFile)
    minio.getObject.mockResolvedValue(Readable.from([await photo()]))

    await service.process(FILE_ID)

    const keys = minio.putObject.mock.calls.map((c) => c[1])
    expect(keys).toEqual([`variants/${FILE_ID}/w320.webp`, `variants/${FILE_ID}/w640.webp`])
    expect(minio.putObject.mock.calls[0][4]).toMatchObject({
      'Content-Type': 'image/webp',
      'Cache-Control': expect.stringContaining('immutable'),
    })
    expect(tx).toHaveLength(3)
    const rows = prisma.fileVariant.createMany.mock.calls[0][0].data
    expect(rows.map((r: { kind: string }) => r.kind)).toEqual([
      MediaVariantKind.IMAGE,
      MediaVariantKind.IMAGE,
    ])
    const update = prisma.file.update.mock.calls[0][0]
    expect(update.data).toMatchObject({ mediaStatus: MediaStatus.READY, width: 1400, height: 1000 })
    expect(update.data.placeholder).toMatch(/^data:image\/webp;base64,/)
  })

  it('«без сжатия» — без вариантов, статус NONE', async () => {
    const { service, prisma, minio } = setup({ ...imageFile, asDocument: true })
    await service.process(FILE_ID)
    expect(minio.getObject).not.toHaveBeenCalled()
    expect(prisma.file.updateMany).toHaveBeenCalledWith({
      where: { id: FILE_ID },
      data: { mediaStatus: MediaStatus.NONE },
    })
  })

  it('уже готов или удалён — ничего не делает (повтор job безопасен)', async () => {
    const ready = setup({ ...imageFile, mediaStatus: MediaStatus.READY })
    await ready.service.process(FILE_ID)
    const gone = setup(null)
    await gone.service.process(FILE_ID)
    expect(ready.minio.getObject).not.toHaveBeenCalled()
    expect(gone.minio.getObject).not.toHaveBeenCalled()
  })

  it('файл удалили посреди обработки — залитые варианты убираются, ошибки нет', async () => {
    const { service, prisma, minio } = setup(imageFile)
    minio.getObject.mockResolvedValue(Readable.from([await photo()]))
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('нет записи', { code: 'P2025', clientVersion: 'x' }),
    )
    minio.listObjectsV2.mockReturnValue(
      Readable.from([{ name: `variants/${FILE_ID}/w320.webp` }], { objectMode: true }),
    )

    await expect(service.process(FILE_ID)).resolves.toBeUndefined()
    expect(minio.removeObjects).toHaveBeenCalledWith('chat-media', [
      `variants/${FILE_ID}/w320.webp`,
    ])
  })
})

describe('MediaProcessingService.process — видео без ffmpeg', () => {
  const videoFile = { ...imageFile, key: 'u/clip.mp4', mime: 'video/mp4' }

  afterEach(() => jest.restoreAllMocks())

  it('остаётся в PENDING, а не FAILED: cron вернёт его в очередь, когда ffmpeg появится', async () => {
    jest.spyOn(ffmpeg, 'isAvailable').mockResolvedValue(false)
    const { service, prisma, minio } = setup(videoFile)

    await service.process(FILE_ID)

    expect(prisma.file.updateMany).toHaveBeenCalledWith({
      where: { id: FILE_ID },
      data: { mediaStatus: MediaStatus.PENDING },
    })
    expect(prisma.file.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { mediaStatus: MediaStatus.FAILED } }),
    )
    expect(minio.getObject).not.toHaveBeenCalled()
  })

  it('отсутствие ffmpeg перепроверяется — установка подхватывается без перезапуска', async () => {
    const available = jest.spyOn(ffmpeg, 'isAvailable').mockResolvedValue(false)
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const { service } = setup(videoFile)

    await service.process(FILE_ID)
    await service.process(FILE_ID)
    // В пределах минуты — из памяти, без лишних запусков бинарника.
    expect(available).toHaveBeenCalledTimes(2)

    now.mockReturnValue(1_000_000 + 61_000)
    await service.process(FILE_ID)
    expect(available).toHaveBeenCalledTimes(4)
  })
})

describe('MediaProcessingService.process — звук в видеоконтейнере', () => {
  const voiceFile = { ...imageFile, key: 'u/voice.webm', mime: 'video/webm' }

  afterEach(() => jest.restoreAllMocks())

  it('голосовое (webm без видеодорожки) — NONE с длительностью, а не FAILED', async () => {
    jest.spyOn(ffmpeg, 'isAvailable').mockResolvedValue(true)
    jest
      .spyOn(ffmpeg, 'probe')
      .mockResolvedValue({ width: 0, height: 0, durationMs: 4200, hasAudio: true })
    const { service, prisma } = setup(voiceFile)

    await service.process(FILE_ID)

    expect(prisma.file.updateMany).toHaveBeenLastCalledWith({
      where: { id: FILE_ID },
      data: { mediaStatus: MediaStatus.NONE, durationMs: 4200 },
    })
    expect(prisma.file.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { mediaStatus: MediaStatus.FAILED } }),
    )
  })
})

describe('MediaProcessingService.copy', () => {
  it('копирует объекты источника под свой префикс и переписывает ключи строк', async () => {
    const source = '22222222-2222-4222-8222-222222222222'
    const { service, prisma, minio } = setup(null)
    prisma.file.findUnique
      .mockResolvedValueOnce({
        bucket: 'chat-media',
        width: 1280,
        height: 720,
        placeholder: 'data:x',
        durationMs: 5000,
        mediaStatus: MediaStatus.READY,
        variants: [
          {
            kind: MediaVariantKind.HLS,
            width: 1280,
            height: 720,
            key: `variants/${source}/hls/720/index.m3u8`,
            mime: 'application/vnd.apple.mpegurl',
            size: 10,
            bitrate: 1,
          },
        ],
      })
      .mockResolvedValueOnce({ id: FILE_ID, bucket: 'chat-media' })
    minio.listObjectsV2.mockReturnValue(
      Readable.from(
        [
          { name: `variants/${source}/hls/720/index.m3u8` },
          { name: `variants/${source}/hls/720/seg-0000.ts` },
        ],
        { objectMode: true },
      ),
    )

    await service.copy(source, FILE_ID)

    expect(minio.copyObject).toHaveBeenCalledWith(
      'chat-media',
      `variants/${FILE_ID}/hls/720/seg-0000.ts`,
      `/chat-media/variants/${source}/hls/720/seg-0000.ts`,
    )
    const rows = prisma.fileVariant.createMany.mock.calls[0][0].data
    expect(rows[0].key).toBe(`variants/${FILE_ID}/hls/720/index.m3u8`)
    expect(prisma.file.update.mock.calls[0][0].data).toMatchObject({
      durationMs: 5000,
      mediaStatus: MediaStatus.READY,
    })
  })
})

describe('MediaProcessingService.markFailed', () => {
  it('ставит FAILED и убирает залитые неудачными попытками постер и сегменты', async () => {
    const { service, prisma, minio } = setup({ bucket: 'chat-media' })
    minio.listObjectsV2.mockReturnValue(
      Readable.from(
        [
          { name: `variants/${FILE_ID}/poster-w640.webp` },
          { name: `variants/${FILE_ID}/hls/720/seg-0000.ts` },
        ],
        { objectMode: true },
      ),
    )

    await service.markFailed(FILE_ID)

    expect(prisma.file.updateMany).toHaveBeenCalledWith({
      where: { id: FILE_ID, mediaStatus: { not: MediaStatus.READY } },
      data: { mediaStatus: MediaStatus.FAILED },
    })
    expect(minio.listObjectsV2).toHaveBeenCalledWith('chat-media', `variants/${FILE_ID}/`, true)
    expect(minio.removeObjects).toHaveBeenCalledWith('chat-media', [
      `variants/${FILE_ID}/poster-w640.webp`,
      `variants/${FILE_ID}/hls/720/seg-0000.ts`,
    ])
  })

  it('файл уже готов — ни статус, ни объекты не трогает', async () => {
    const { service, prisma, minio } = setup({ bucket: 'chat-media' })
    prisma.file.updateMany.mockResolvedValue({ count: 0 })

    await service.markFailed(FILE_ID)

    expect(minio.listObjectsV2).not.toHaveBeenCalled()
    expect(minio.removeObjects).not.toHaveBeenCalled()
  })
})
