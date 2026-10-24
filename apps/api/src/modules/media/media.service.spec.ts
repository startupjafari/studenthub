import { Readable } from 'node:stream'
import { JwtService } from '@nestjs/jwt'
import { MediaStatus, MediaVariantKind } from '@prisma/client'
import { MediaService } from './media.service'
import type { MediaFile } from './media.types'

type Mock = jest.Mock

const ENV: Record<string, unknown> = {
  MINIO_BUCKET_CHAT: 'chat-media',
  MINIO_BUCKET_POSTS: 'posts-media',
  MINIO_BUCKET_STORIES: 'stories-media',
  MINIO_BUCKET_PROFILE_MEDIA: 'profile-media',
  MINIO_BUCKET_MATERIALS: 'materials',
  MINIO_BUCKET_AVATARS: 'avatars',
  MINIO_BUCKET_PROFILE_COVERS: 'profile-covers',
  MINIO_ENDPOINT: 'minio.local',
  MINIO_PORT: 9000,
  MINIO_USE_SSL: false,
  JWT_ACCESS_SECRET: 'x'.repeat(40),
  API_PREFIX: 'api/v1',
}

const FILE_ID = '11111111-1111-4111-8111-111111111111'

function setup() {
  const prisma = {
    file: {
      update: jest.fn().mockResolvedValue({}) as Mock,
      findMany: jest.fn().mockResolvedValue([]) as Mock,
      findUnique: jest.fn() as Mock,
    },
  }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) as Mock }
  const config = { get: jest.fn((k: string) => ENV[k]) as Mock }
  const minio = {
    getObject: jest.fn() as Mock,
    listObjectsV2: jest.fn() as Mock,
    removeObjects: jest.fn().mockResolvedValue(undefined) as Mock,
  }
  const minioPublic = {
    presignedGetObject: jest.fn(
      async (bucket: string, key: string, _ttl: number, _h: unknown, date: Date) =>
        `https://cdn/${bucket}/${key}?d=${date.getTime()}`,
    ) as Mock,
  }
  const jwt = new JwtService({})
  const service = new MediaService(
    prisma as never,
    queue as never,
    config as never,
    jwt,
    minio as never,
    minioPublic as never,
  )
  return { service, prisma, queue, minio, minioPublic, jwt }
}

function mediaFile(overrides: Partial<MediaFile> = {}): MediaFile {
  return {
    id: FILE_ID,
    bucket: 'chat-media',
    mime: 'image/jpeg',
    width: 1600,
    height: 1200,
    mediaStatus: MediaStatus.READY,
    placeholder: 'data:image/webp;base64,AAA',
    durationMs: null,
    variants: [
      {
        kind: MediaVariantKind.IMAGE,
        width: 320,
        height: 240,
        key: `variants/${FILE_ID}/w320.webp`,
        mime: 'image/webp',
        bitrate: null,
      },
      {
        kind: MediaVariantKind.IMAGE,
        width: 640,
        height: 480,
        key: `variants/${FILE_ID}/w640.webp`,
        mime: 'image/webp',
        bitrate: null,
      },
    ],
    ...overrides,
  }
}

describe('MediaService.schedule', () => {
  it('медиа в медийном бакете — статус PENDING и задача с детерминированным jobId', async () => {
    const { service, prisma, queue } = setup()
    await service.schedule({ id: FILE_ID, bucket: 'chat-media', mime: 'video/mp4' })
    expect(prisma.file.update).toHaveBeenCalledWith({
      where: { id: FILE_ID },
      data: { mediaStatus: MediaStatus.PENDING },
    })
    expect(queue.enqueue).toHaveBeenCalledWith(
      'media-video',
      'process-media',
      { fileId: FILE_ID },
      expect.objectContaining({ jobId: `media_${FILE_ID}`, attempts: 2 }),
    )
  })

  it('документ, аватар и аудио не обрабатываются', async () => {
    const { service, queue } = setup()
    await service.schedule({ id: FILE_ID, bucket: 'chat-media', mime: 'application/pdf' })
    await service.schedule({ id: FILE_ID, bucket: 'avatars', mime: 'image/png' })
    await service.schedule({ id: FILE_ID, bucket: 'chat-media', mime: 'audio/ogg' })
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})

describe('MediaService.scheduleCopy', () => {
  const SOURCE_ID = '22222222-2222-4222-8222-222222222222'
  const target = { id: FILE_ID, bucket: 'chat-media', mediaStatus: MediaStatus.PENDING }

  it('готовые варианты копируются в быстрой очереди — и у видео', async () => {
    const { service, prisma, queue } = setup()
    prisma.file.findUnique.mockResolvedValue({ mediaStatus: MediaStatus.READY })

    await service.scheduleCopy(SOURCE_ID, { ...target, mime: 'video/mp4' })

    expect(queue.enqueue).toHaveBeenCalledWith(
      'media-image',
      'copy-media-variants',
      { sourceId: SOURCE_ID, fileId: FILE_ID },
      expect.objectContaining({ jobId: `media-copy_${FILE_ID}` }),
    )
  })

  it('копия неготового видео идёт в очередь видео: откат к ffmpeg не держит фото', async () => {
    const { service, prisma, queue } = setup()
    prisma.file.findUnique.mockResolvedValue({ mediaStatus: MediaStatus.PROCESSING })

    await service.scheduleCopy(SOURCE_ID, { ...target, mime: 'video/mp4' })

    expect(queue.enqueue).toHaveBeenCalledWith(
      'media-video',
      'copy-media-variants',
      { sourceId: SOURCE_ID, fileId: FILE_ID },
      expect.objectContaining({ jobId: `media-copy_${FILE_ID}`, attempts: 2 }),
    )
  })

  it('копия изображения — всегда в очереди фото', async () => {
    const { service, prisma, queue } = setup()

    await service.scheduleCopy(SOURCE_ID, { ...target, mime: 'image/jpeg' })

    expect(prisma.file.findUnique).not.toHaveBeenCalled()
    expect(queue.enqueue).toHaveBeenCalledWith(
      'media-image',
      'copy-media-variants',
      expect.anything(),
      expect.anything(),
    )
  })
})

describe('MediaService.describeOne', () => {
  it('приватный бакет: srcset из подписанных ссылок, стабильных в пределах окна', async () => {
    const { service } = setup()
    const now = Date.UTC(2026, 9, 16, 10, 2, 30)
    const a = await service.describeOne(mediaFile(), now)
    const b = await service.describeOne(mediaFile(), now + 60_000)

    expect(a.sources.map((s) => s.width)).toEqual([320, 640])
    expect(a.sources[0]!.url).toBe(b.sources[0]!.url)
    expect(a.placeholder).toBe('data:image/webp;base64,AAA')
    expect(a.expiresAt).not.toBeNull()
    expect(a.hls).toBeNull()
  })

  it('публичный бакет: постоянные URL без срока', async () => {
    const { service, minioPublic } = setup()
    const info = await service.describeOne(mediaFile({ bucket: 'profile-media' }))
    expect(info.sources[0]!.url).toBe(
      `http://minio.local:9000/profile-media/variants/${FILE_ID}/w320.webp`,
    )
    expect(info.expiresAt).toBeNull()
    expect(minioPublic.presignedGetObject).not.toHaveBeenCalled()
  })

  it('не готов — только заглушка и размеры, без вариантов', async () => {
    const { service } = setup()
    const info = await service.describeOne(mediaFile({ mediaStatus: MediaStatus.PROCESSING }))
    expect(info.status).toBe(MediaStatus.PROCESSING)
    expect(info.sources).toEqual([])
    expect(info.expiresAt).toBeNull()
  })
})

describe('MediaService — HLS', () => {
  const video = () =>
    mediaFile({
      mime: 'video/mp4',
      durationMs: 60_000,
      variants: [
        {
          kind: MediaVariantKind.HLS,
          width: 640,
          height: 360,
          key: `variants/${FILE_ID}/hls/360/index.m3u8`,
          mime: 'application/vnd.apple.mpegurl',
          bitrate: 700_000,
        },
        {
          kind: MediaVariantKind.HLS,
          width: 1280,
          height: 720,
          key: `variants/${FILE_ID}/hls/720/index.m3u8`,
          mime: 'application/vnd.apple.mpegurl',
          bitrate: 2_000_000,
        },
      ],
    })

  function tokenFrom(path: string): string {
    return new URL(path, 'http://x').searchParams.get('t') as string
  }

  it('публичный бакет с HLS: expiresAt — срок токена плейлиста, а не null', async () => {
    const { service, jwt } = setup()
    const now = Date.UTC(2026, 9, 16, 10, 2, 30)
    const info = await service.describeOne({ ...video(), bucket: 'profile-media' }, now)

    expect(info.hls).not.toBeNull()
    const { exp } = jwt.decode<{ exp: number }>(tokenFrom(info.hls as string))
    expect(info.expiresAt).toBe(new Date(exp * 1000).toISOString())
  })

  it('мастер-плейлист по master-токену перечисляет рендишны с play-токеном', async () => {
    const { service, prisma } = setup()
    const info = await service.describeOne(video())
    expect(info.hls).toMatch(new RegExp(`^/api/v1/media/${FILE_ID}/hls/master\\.m3u8\\?t=`))
    prisma.file.findUnique.mockResolvedValue({
      bucket: 'chat-media',
      durationMs: 60_000,
      variants: video().variants,
    })

    const master = await service.masterPlaylist(FILE_ID, tokenFrom(info.hls as string))

    expect(master).toContain('RESOLUTION=640x360')
    expect(master).toContain('RESOLUTION=1280x720')
    expect(master).toMatch(/^360\/index\.m3u8\?t=.+$/m)
  })

  it('токен чужого файла или чужого вида не принимается', async () => {
    const { service } = setup()
    const info = await service.describeOne(video())
    const token = tokenFrom(info.hls as string)
    await expect(
      service.masterPlaylist('22222222-2222-4222-8222-222222222222', token),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // master-токен не годится для сегментов: те принимают только play-токен.
    await expect(service.segmentUrl(FILE_ID, '720', 'seg-0001.ts', token)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(service.masterPlaylist(FILE_ID, undefined)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('плейлист рендишна дописывает токен к сегментам, сегмент — подписанная ссылка', async () => {
    const { service, prisma, minio } = setup()
    const info = await service.describeOne(video())
    prisma.file.findUnique.mockResolvedValue({
      bucket: 'chat-media',
      durationMs: 60_000,
      variants: video().variants,
    })
    const master = await service.masterPlaylist(FILE_ID, tokenFrom(info.hls as string))
    const play = master.match(/720\/index\.m3u8\?t=(.+)$/m)![1]!
    minio.getObject.mockResolvedValue(
      Readable.from([Buffer.from('#EXTM3U\n#EXTINF:4.0,\nseg-0000.ts\n#EXT-X-ENDLIST\n')]),
    )

    const playlist = await service.renditionPlaylist(FILE_ID, '720', play)
    expect(playlist).toContain(`seg-0000.ts?t=${play}`)
    expect(minio.getObject).toHaveBeenCalledWith(
      'chat-media',
      `variants/${FILE_ID}/hls/720/index.m3u8`,
    )

    const url = await service.segmentUrl(FILE_ID, '720', 'seg-0000.ts', play)
    expect(url).toContain(`chat-media/variants/${FILE_ID}/hls/720/seg-0000.ts`)
  })

  it('имя сегмента и рендишна проверяется до токена: обход каталога невозможен', async () => {
    const { service } = setup()
    await expect(service.segmentUrl(FILE_ID, '720', '../../secret.pdf', 'x')).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    )
    await expect(service.renditionPlaylist(FILE_ID, '..', 'x')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

describe('MediaService.resumeAndBackfill', () => {
  // F-F26: job, потерянный уже в PROCESSING (сброс Redis), оставлял файл «в обработке»
  // навсегда — догонялка смотрела только PENDING и NONE.
  it('возвращает в очередь и застрявшие в PROCESSING дольше часа', async () => {
    const { service, prisma, queue } = setup()
    prisma.file.findMany
      .mockResolvedValueOnce([{ id: 'p', bucket: 'chat-media', mime: 'video/mp4' }])
      .mockResolvedValueOnce([])
    const before = Date.now()

    await expect(service.resumeAndBackfill()).resolves.toEqual({ resumed: 1, backfilled: 0 })

    const where = prisma.file.findMany.mock.calls[0][0].where as {
      OR: { mediaStatus: string; createdAt: { lt: Date } }[]
    }
    const processing = where.OR.find((branch) => branch.mediaStatus === 'PROCESSING')
    expect(processing).toBeDefined()
    // Окно — час от загрузки: идущее перекодирование не трогаем раньше времени.
    const cutoff = processing?.createdAt.lt.getTime() ?? 0
    expect(cutoff).toBeGreaterThanOrEqual(before - 60 * 60 * 1000)
    expect(cutoff).toBeLessThanOrEqual(Date.now() - 60 * 60 * 1000)
    expect(where.OR.find((branch) => branch.mediaStatus === 'PENDING')).toBeDefined()
    expect(queue.enqueue).toHaveBeenCalledWith(
      'media-video',
      'process-media',
      { fileId: 'p' },
      expect.objectContaining({ jobId: 'media_p' }),
    )
  })

  it('застрявшие PENDING возвращаются в очередь, необработанные ставятся впервые', async () => {
    const { service, prisma, queue } = setup()
    prisma.file.findMany
      .mockResolvedValueOnce([{ id: 'a', bucket: 'posts-media', mime: 'image/png' }])
      .mockResolvedValueOnce([{ id: 'b', bucket: 'chat-media', mime: 'video/webm' }])

    await expect(service.resumeAndBackfill()).resolves.toEqual({ resumed: 1, backfilled: 1 })
    expect(queue.enqueue).toHaveBeenCalledWith(
      'media-image',
      'process-media',
      { fileId: 'a' },
      expect.objectContaining({ jobId: 'media_a' }),
    )
    expect(queue.enqueue).toHaveBeenCalledWith(
      'media-video',
      'process-media',
      { fileId: 'b' },
      expect.objectContaining({ jobId: 'media_b' }),
    )
  })
})
