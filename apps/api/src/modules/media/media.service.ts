import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { MediaStatus, MediaVariantKind, Prisma } from '@prisma/client'
import type { Client as MinioClient } from 'minio'
import { PrismaService } from '../../common/prisma/prisma.service'
import { MINIO_CLIENT, MINIO_PUBLIC_CLIENT } from '../../common/minio/minio.constants'
import { buildPublicObjectUrl } from '../../common/minio/public-url'
import { presignStableGet, signingWindow } from '../../common/minio/stable-sign'
import { AppException } from '../../common/exceptions/app.exception'
import { MEDIA_JOBS, QUEUES, QueueService } from '../../common/queue'
import type { EnvVars } from '../../config/env.schema'
import {
  HLS_LADDER,
  HLS_TOKEN_TTL_SECONDS,
  MEDIA_BUCKET_KEYS,
  PUBLIC_MEDIA_BUCKET_KEYS,
} from './media.constants'
import { hlsRenditionDir, variantPrefix } from './media-keys'
import type { MediaFile, MediaInfo, MediaSource } from './media.types'

// Имя сегмента и рендишна в маршрутах HLS: то, что пишет ffmpeg, и ничего больше —
// значение уходит в ключ объекта, и `../` из адреса туда попасть не должен.
const SEGMENT_RE = /^seg-\d{4,6}\.ts$/
const RENDITION_RE = /^\d{2,4}$/

// Сколько файлов за проход берёт догонялка обработки (cron в CleanupService).
const RESUME_BATCH = 200
// Через сколько после загрузки файл в PROCESSING считается потерявшим свой job.
const PROCESSING_STUCK_MS = 60 * 60 * 1000

type TokenKind = 'master' | 'play'

interface HlsTokenPayload {
  fid: string
  b: string
  k: TokenKind
}

/**
 * Единая медиа-система — сторона API: постановка обработки в очередь и описание готовых
 * вариантов для ответа. Тяжёлая работа (sharp, ffmpeg) — в `MediaProcessingService`,
 * который живёт в воркере (MEDIA_PROCESSING=worker) или в процессе API (inline).
 *
 * Права доступа здесь НЕ проверяются: описание выдаёт модуль-владелец после своей проверки
 * (членство в чате, видимость поста, scope материала) — так же, как он выдаёт ссылку на
 * оригинал. Варианты лежат в том же бакете, что и оригинал, и наследуют его приватность.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name)
  private readonly mediaBuckets: Set<string>
  private readonly publicBuckets: Set<string>
  private readonly tokenSecret: string
  private readonly apiPrefix: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly jwt: JwtService,
    @Inject(MINIO_CLIENT) private readonly minio: MinioClient,
    @Inject(MINIO_PUBLIC_CLIENT) private readonly minioPublic: MinioClient,
  ) {
    this.mediaBuckets = new Set(MEDIA_BUCKET_KEYS.map((k) => this.config.get(k, { infer: true })))
    this.publicBuckets = new Set(
      PUBLIC_MEDIA_BUCKET_KEYS.map((k) => this.config.get(k, { infer: true })),
    )
    // Свой секрет, а не JWT_ACCESS_SECRET как есть: токен плейлиста, подписанный ключом
    // access-токенов, прошёл бы проверку подписи в JwtStrategy.
    this.tokenSecret =
      this.config.get('MEDIA_TOKEN_SECRET', { infer: true }) ??
      `${this.config.get('JWT_ACCESS_SECRET', { infer: true })}:media-hls`
    this.apiPrefix = this.config.get('API_PREFIX', { infer: true }).replace(/^\/+|\/+$/g, '')
  }

  /** Изображение или видео в бакете, медиа которого обрабатывается. */
  kindOf(bucket: string, mime: string): 'image' | 'video' | null {
    if (!this.mediaBuckets.has(bucket)) return null
    if (mime.startsWith('image/')) return 'image'
    if (mime.startsWith('video/')) return 'video'
    return null
  }

  /**
   * Статус для новой записи File: PENDING, если медиа будет обработано. Ставится прямо при
   * создании записи — ответ на загрузку сразу честный, и лишней записи в БД нет.
   */
  initialStatus(bucket: string, mime: string): MediaStatus {
    return this.kindOf(bucket, mime) ? MediaStatus.PENDING : MediaStatus.NONE
  }

  /**
   * Поставить файл в обработку. Вызывается сразу после создания записи File; HTTP-запрос
   * ничего не ждёт. Повторный вызов безопасен: jobId детерминирован.
   */
  async schedule(file: {
    id: string
    bucket: string
    mime: string
    mediaStatus?: MediaStatus
  }): Promise<void> {
    const kind = this.kindOf(file.bucket, file.mime)
    if (!kind) return
    // Запись создана сразу с PENDING (initialStatus) — второй update не нужен.
    if (file.mediaStatus !== MediaStatus.PENDING && !(await this.markPending(file.id))) return
    await this.enqueue(kind, MEDIA_JOBS.PROCESS, { fileId: file.id }, `media_${file.id}`)
  }

  /**
   * Копия файла (пересылка вложения): варианты источника копируются в хранилище, а не
   * готовятся заново. Источник ещё не готов — воркер сам откатится к обычной обработке.
   */
  async scheduleCopy(
    sourceId: string,
    target: { id: string; bucket: string; mime: string; mediaStatus?: MediaStatus },
  ): Promise<void> {
    if (!this.kindOf(target.bucket, target.mime)) return
    if (target.mediaStatus !== MediaStatus.PENDING && !(await this.markPending(target.id))) return
    // Копирование — секунды при любом типе, поэтому в «быструю» очередь.
    await this.enqueue(
      'image',
      MEDIA_JOBS.COPY,
      { sourceId, fileId: target.id },
      `media-copy_${target.id}`,
    )
  }

  private async markPending(fileId: string): Promise<boolean> {
    try {
      await this.prisma.file.update({
        where: { id: fileId },
        data: { mediaStatus: MediaStatus.PENDING },
      })
      return true
    } catch (err) {
      // Файл успели удалить — обрабатывать нечего.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') return false
      throw err
    }
  }

  private enqueue(
    kind: 'image' | 'video',
    job: string,
    data: Record<string, string>,
    jobId: string,
  ): Promise<void> {
    const queue = kind === 'video' ? QUEUES.MEDIA_VIDEO : QUEUES.MEDIA_IMAGE
    // Видео — две попытки, а не три: третья почти всегда упадёт там же, а час CPU съест.
    return this.queue.enqueue(queue, job, data, { jobId, ...(kind === 'video' && { attempts: 2 }) })
  }

  /**
   * Догонялка: файлы, застрявшие в PENDING (постановка в очередь — best effort и могла
   * не дойти до Redis), и ещё не обработанные старые медиа (backfill). Повторная постановка
   * безопасна: живая задача с тем же jobId BullMQ просто не продублирует.
   *
   * И застрявшие в PROCESSING (F-F26): job мог пропасть уже после смены статуса — сброс
   * Redis, ручная чистка очереди, — и такой файл оставался «в обработке» навсегда. Окно
   * больше, чем у PENDING: настоящее перекодирование длинного видео идёт долго. Отметки
   * начала обработки у файла нет, поэтому меряем от загрузки — и это безопасно: идущий
   * job с тем же jobId постановка не продублирует, вернётся только потерянный.
   */
  async resumeAndBackfill(): Promise<{ resumed: number; backfilled: number }> {
    const stuckBefore = new Date(Date.now() - 10 * 60 * 1000)
    const processingStuckBefore = new Date(Date.now() - PROCESSING_STUCK_MS)
    const mediaMime = {
      OR: [{ mime: { startsWith: 'image/' } }, { mime: { startsWith: 'video/' } }],
    }
    const select = { id: true, bucket: true, mime: true } as const
    const [stuck, fresh] = await Promise.all([
      this.prisma.file.findMany({
        where: {
          OR: [
            { mediaStatus: MediaStatus.PENDING, createdAt: { lt: stuckBefore } },
            { mediaStatus: MediaStatus.PROCESSING, createdAt: { lt: processingStuckBefore } },
          ],
        },
        select,
        orderBy: { createdAt: 'asc' },
        take: RESUME_BATCH,
      }),
      this.prisma.file.findMany({
        where: {
          mediaStatus: MediaStatus.NONE,
          bucket: { in: [...this.mediaBuckets] },
          asDocument: false,
          ...mediaMime,
        },
        select,
        // Свежие первыми: их скорее всего откроют, а архив подождёт.
        orderBy: { createdAt: 'desc' },
        take: RESUME_BATCH,
      }),
    ])
    for (const f of stuck) {
      const kind = this.kindOf(f.bucket, f.mime)
      if (kind) await this.enqueue(kind, MEDIA_JOBS.PROCESS, { fileId: f.id }, `media_${f.id}`)
    }
    for (const f of fresh) await this.schedule(f)
    return { resumed: stuck.length, backfilled: fresh.length }
  }

  /** Удалить все производные объекты файла (строки FileVariant уходят каскадом). */
  async purgeVariants(bucket: string, fileId: string): Promise<void> {
    const keys: string[] = []
    const stream = this.minio.listObjectsV2(bucket, variantPrefix(fileId), true)
    for await (const obj of stream as AsyncIterable<{ name?: string }>) {
      if (obj.name) keys.push(obj.name)
    }
    if (keys.length > 0) await this.minio.removeObjects(bucket, keys)
  }

  // ── Описание для клиента ──

  async describe(files: MediaFile[], now = Date.now()): Promise<Map<string, MediaInfo>> {
    const out = new Map<string, MediaInfo>()
    await Promise.all(files.map(async (f) => out.set(f.id, await this.describeOne(f, now))))
    return out
  }

  async describeOne(file: MediaFile, now = Date.now()): Promise<MediaInfo> {
    const ready = file.mediaStatus === MediaStatus.READY
    const isPublic = this.publicBuckets.has(file.bucket)
    const pick = (kind: MediaVariantKind) =>
      ready ? file.variants.filter((v) => v.kind === kind) : []
    const toSources = (rows: ReturnType<typeof pick>): Promise<MediaSource[]> =>
      Promise.all(
        rows.map(async (v) => ({
          width: v.width,
          height: v.height,
          url: isPublic
            ? buildPublicObjectUrl(this.config, file.bucket, v.key)
            : await presignStableGet(this.minioPublic, file.bucket, v.key, {}, now),
        })),
      )
    const [sources, poster] = await Promise.all([
      toSources(pick(MediaVariantKind.IMAGE)),
      toSources(pick(MediaVariantKind.POSTER)),
    ])
    const hls = pick(MediaVariantKind.HLS).length > 0 ? this.masterPath(file, now) : null
    const signed = !isPublic && (sources.length > 0 || poster.length > 0 || hls !== null)
    return {
      status: file.mediaStatus,
      placeholder: file.placeholder,
      width: file.width,
      height: file.height,
      durationMs: file.durationMs,
      sources,
      poster,
      hls,
      expiresAt: signed ? signingWindow(now).expiresAt.toISOString() : null,
    }
  }

  // ── HLS ──

  private masterPath(file: { id: string; bucket: string }, now: number): string {
    const token = this.issueToken('master', file.id, file.bucket, HLS_TOKEN_TTL_SECONDS, now)
    return `/${this.apiPrefix}/media/${file.id}/hls/master.m3u8?t=${token}`
  }

  /**
   * Токен доступа к плейлистам. Срок отсчитывается от начала окна подписи, а не от «сейчас»:
   * внутри окна токен, а с ним и URL плейлиста, байт в байт тот же (см. stable-sign).
   */
  private issueToken(
    kind: TokenKind,
    fileId: string,
    bucket: string,
    ttlSeconds: number,
    now = Date.now(),
  ): string {
    const start = signingWindow(now).requestDate.getTime()
    const exp = Math.floor(start / 1000) + ttlSeconds
    const payload: HlsTokenPayload & { exp: number } = { fid: fileId, b: bucket, k: kind, exp }
    return this.jwt.sign(payload, { secret: this.tokenSecret, noTimestamp: true })
  }

  private verifyToken(token: string | undefined, fileId: string, kind: TokenKind): string {
    const denied = () =>
      new AppException('FORBIDDEN', 'Ссылка на видео недействительна или устарела')
    if (!token) throw denied()
    let payload: HlsTokenPayload
    try {
      payload = this.jwt.verify<HlsTokenPayload>(token, { secret: this.tokenSecret })
    } catch {
      throw denied()
    }
    if (payload.fid !== fileId || payload.k !== kind) throw denied()
    return payload.b
  }

  /**
   * Мастер-плейлист: список рендишнов. Выдаётся по master-токену (15 минут) и раздаёт
   * play-токен на весь просмотр: ролик дольше 15 минут иначе обрывался бы на середине,
   * когда протухнут ссылки следующих сегментов.
   */
  async masterPlaylist(fileId: string, token: string | undefined): Promise<string> {
    const bucket = this.verifyToken(token, fileId, 'master')
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      select: {
        bucket: true,
        durationMs: true,
        variants: {
          where: { kind: MediaVariantKind.HLS },
          select: { width: true, height: true, bitrate: true, key: true },
          orderBy: { width: 'asc' },
          take: 16,
        },
      },
    })
    if (!file || file.bucket !== bucket || file.variants.length === 0) {
      throw new AppException('NOT_FOUND', 'Видео не найдено')
    }
    const playTtl = HLS_TOKEN_TTL_SECONDS + Math.ceil(((file.durationMs ?? 0) / 1000) * 2)
    const play = this.issueToken('play', fileId, bucket, playTtl)
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-INDEPENDENT-SEGMENTS']
    for (const v of file.variants) {
      const short = Math.min(v.width, v.height)
      const rung = HLS_LADDER.find((r) => r.short === short) ?? HLS_LADDER[0]
      const peak = (rung.videoKbps + rung.audioKbps) * 1000
      const average = v.bitrate ?? peak
      const name = v.key.split('/').at(-2)
      lines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${Math.max(peak, average)},AVERAGE-BANDWIDTH=${average},RESOLUTION=${v.width}x${v.height}`,
        `${name}/index.m3u8?t=${play}`,
      )
    }
    return `${lines.join('\n')}\n`
  }

  /** Плейлист рендишна: тот, что записал ffmpeg, с play-токеном у каждого сегмента. */
  async renditionPlaylist(
    fileId: string,
    rendition: string,
    token: string | undefined,
  ): Promise<string> {
    if (!RENDITION_RE.test(rendition)) throw new AppException('NOT_FOUND', 'Видео не найдено')
    const bucket = this.verifyToken(token, fileId, 'play')
    const key = `${hlsRenditionDir(fileId, Number(rendition))}index.m3u8`
    let text: string
    try {
      const chunks: Buffer[] = []
      for await (const chunk of await this.minio.getObject(bucket, key))
        chunks.push(chunk as Buffer)
      text = Buffer.concat(chunks).toString('utf8')
    } catch {
      throw new AppException('NOT_FOUND', 'Видео не найдено')
    }
    // Токен из запроса, а не новый: сегменты должны жить столько же, сколько просмотр.
    const t = encodeURIComponent(token as string)
    return text
      .split('\n')
      .map((line) => (line && !line.startsWith('#') ? `${line.trim()}?t=${t}` : line))
      .join('\n')
  }

  /**
   * Подписанная ссылка на сегмент. Отдаётся редиректом, а не байтами: видео идёт из
   * хранилища напрямую, API только решает, можно ли.
   */
  async segmentUrl(
    fileId: string,
    rendition: string,
    segment: string,
    token: string | undefined,
  ): Promise<string> {
    if (!RENDITION_RE.test(rendition) || !SEGMENT_RE.test(segment)) {
      throw new AppException('NOT_FOUND', 'Видео не найдено')
    }
    const bucket = this.verifyToken(token, fileId, 'play')
    const key = `${hlsRenditionDir(fileId, Number(rendition))}${segment}`
    return presignStableGet(this.minioPublic, bucket, key, {
      'response-content-type': 'video/mp2t',
    })
  }
}
