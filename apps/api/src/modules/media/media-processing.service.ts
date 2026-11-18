import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { MediaStatus, MediaVariantKind, Prisma } from '@prisma/client'
import type { Client as MinioClient } from 'minio'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaService } from '../../common/prisma/prisma.service'
import { MINIO_CLIENT } from '../../common/minio/minio.constants'
import type { EnvVars } from '../../config/env.schema'
import {
  cutSegment,
  extractFrame,
  isAvailable,
  probe,
  transcodeAnimation,
  transcodeHls,
} from './ffmpeg'
import {
  animationFrames,
  buildImageVariants,
  buildPosterVariants,
  type EncodedVariant,
} from './image-pipeline'
import { ANIMATION_CRF, ANIMATION_MAX_SECONDS, VARIANT_CACHE_CONTROL } from './media.constants'
import { hlsRenditionDir, imageVariantKey, posterVariantKey, variantPrefix } from './media-keys'
import { planAnimation, planHlsLadder, posterTimestamp } from './media-plan'
import type { VariantRow, VideoTrim } from './media.types'

// Потолок чтения изображения в память. Лимит категории IMAGE — 10 МБ; запас на случай,
// если лимит поднимут, но не настолько, чтобы чужой «картинкой» положить воркер.
const MAX_IMAGE_BYTES = 64 * 1024 * 1024

// Сколько ffmpeg может перекодировать ролик: вчетверо дольше его длительности, но не меньше
// 15 минут. Дальше процесс считается зависшим и убивается — job уйдёт на повторную попытку.
const MIN_TRANSCODE_MS = 15 * 60 * 1000
const TRANSCODE_SPEED_FACTOR = 4

// Ссылка, по которой ffmpeg читает исходник из внутреннего MinIO. Срок — с запасом на самое
// долгое перекодирование: ссылка никуда не уходит из воркера.
const SOURCE_URL_TTL_SECONDS = 6 * 60 * 60

// Перевод GIF в MP4: потолок 10 МБ на входе и минута на выходе — это секунды работы, а
// десять минут отсекают только зависший процесс.
const ANIMATION_TRANSCODE_MS = 10 * 60 * 1000

// Через сколько перепроверять отсутствующий ffmpeg (см. hasFfmpeg).
const FFMPEG_RECHECK_MS = 60 * 1000

// Временные каталоги старше этого — остатки упавшего процесса, их можно сносить.
const STALE_TMP_MS = 12 * 60 * 60 * 1000
const TMP_DIR_NAME = 'studenthub-media'

const HLS_CONTENT_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
}

interface SourceFile {
  id: string
  bucket: string
  key: string
  mime: string
  asDocument: boolean
  animation: boolean
  mediaStatus: MediaStatus
}

const SOURCE_SELECT = {
  id: true,
  bucket: true,
  key: true,
  mime: true,
  asDocument: true,
  animation: true,
  mediaStatus: true,
} as const

/**
 * Тяжёлая часть медиа-системы: sharp и ffmpeg. Живёт только там, где зарегистрированы
 * процессоры очередей media-image/media-video (воркер или inline-режим API).
 *
 * Каждый шаг идемпотентен: ключи вариантов детерминированы (id файла + размер), строки
 * вариантов заменяются целиком в одной транзакции со сменой статуса. Повторная попытка
 * после падения перезаписывает те же объекты, а не плодит новые.
 */
@Injectable()
export class MediaProcessingService implements OnModuleInit {
  private readonly logger = new Logger(MediaProcessingService.name)
  private readonly ffmpeg: string
  private readonly ffprobe: string
  private readonly tmpRoot: string
  private readonly chatBucket: string
  private ffmpegReady: Promise<boolean> | null = null
  private ffmpegKnown = false
  private ffmpegRecheckAt = 0

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvVars, true>,
    @Inject(MINIO_CLIENT) private readonly minio: MinioClient,
  ) {
    this.ffmpeg = this.config.get('FFMPEG_PATH', { infer: true })
    this.ffprobe = this.config.get('FFPROBE_PATH', { infer: true })
    this.tmpRoot = join(this.config.get('MEDIA_TMP_DIR', { infer: true }) ?? tmpdir(), TMP_DIR_NAME)
    this.chatBucket = this.config.get('MINIO_BUCKET_CHAT', { infer: true })
  }

  /** GIF вложения чата — переводится в MP4 (см. MediaService.isAnimationSource). */
  private isAnimationSource(file: { bucket: string; mime: string }): boolean {
    return file.bucket === this.chatBucket && file.mime === 'image/gif'
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.tmpRoot, { recursive: true })
    await this.sweepStaleTmp()
  }

  /**
   * Временные каталоги, брошенные убитым посреди перекодирования процессом. Идёт при старте
   * и перед каждым видео: воркер, который живёт неделями, тоже должен их убирать. С
   * `fileId` сносит и каталоги прежних попыток этого файла независимо от возраста: процесс
   * убили на нём (OOM), job пришёл снова — иначе каждый круг копил бы ещё одну частичную
   * HLS-раскладку, пока не кончится диск. Параллельно один файл не обрабатывается: jobId
   * детерминирован.
   */
  private async sweepStaleTmp(fileId?: string): Promise<void> {
    const entries = await readdir(this.tmpRoot).catch(() => [] as string[])
    const before = Date.now() - STALE_TMP_MS
    for (const name of entries) {
      const path = join(this.tmpRoot, name)
      if (fileId && name.startsWith(`${fileId}-`)) {
        await rm(path, { recursive: true, force: true })
        continue
      }
      const info = await stat(path).catch(() => null)
      if (info && info.mtimeMs < before) await rm(path, { recursive: true, force: true })
    }
  }

  /**
   * Есть ли ffmpeg и ffprobe. Положительный ответ запоминается навсегда, отрицательный — на
   * минуту: ffmpeg могут доставить в работающее окружение (`apt install` на машине
   * разработчика), и подхватить его надо без перезапуска процесса.
   */
  private hasFfmpeg(): Promise<boolean> {
    const now = Date.now()
    if (this.ffmpegReady && (this.ffmpegKnown || now < this.ffmpegRecheckAt)) {
      return this.ffmpegReady
    }
    this.ffmpegRecheckAt = now + FFMPEG_RECHECK_MS
    this.ffmpegReady = Promise.all([isAvailable(this.ffmpeg), isAvailable(this.ffprobe)]).then(
      ([a, b]) => {
        this.ffmpegKnown = a && b
        if (!this.ffmpegKnown) {
          this.logger.warn(
            `ffmpeg/ffprobe недоступны (${this.ffmpeg}, ${this.ffprobe}) — видео ждут в PENDING, оригинал играет как раньше`,
          )
        }
        return this.ffmpegKnown
      },
    )
    return this.ffmpegReady
  }

  // ── Точки входа процессоров ──

  async process(fileId: string, trim?: VideoTrim): Promise<void> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      select: SOURCE_SELECT,
    })
    if (!file || file.mediaStatus === MediaStatus.READY) return
    // «Отправить без сжатия»: получатель видит строку файла, превью ему не нужны.
    if (file.asDocument) {
      await this.setStatus(file.id, MediaStatus.NONE)
      return
    }
    // Тот же объект уже обработан под другой записью (общий пул медиа сида, «Мои GIF») —
    // копируем. Кроме GIF чата: готовый сосед мог остаться картинкой (обработан до перевода
    // GIF в MP4), а этой записи положен MP4 — копия вернула бы её сюда же, и круг замкнулся бы.
    const sibling = this.isAnimationSource(file)
      ? null
      : await this.prisma.file.findFirst({
          where: {
            bucket: file.bucket,
            key: file.key,
            mediaStatus: MediaStatus.READY,
            id: { not: file.id },
          },
          select: { id: true },
        })
    if (sibling) {
      await this.copy(sibling.id, file.id)
      return
    }
    await this.processSource(file, trim)
  }

  private async processSource(file: SourceFile, trim?: VideoTrim): Promise<void> {
    const isVideo = file.mime.startsWith('video/')
    const isGif = this.isAnimationSource(file)
    const ffmpeg = isVideo || isGif ? await this.hasFfmpeg() : false
    if (isVideo && !ffmpeg) {
      // Не FAILED: это не беда файла, а неготовность окружения. Видео ждёт в PENDING (пока
      // играет оригинал), и cron resumeMediaProcessing вернёт его в очередь, когда ffmpeg
      // появится. FAILED cron не повторяет — такие видео остались бы без HLS навсегда.
      await this.setStatus(file.id, MediaStatus.PENDING)
      return
    }
    await this.setStatus(file.id, MediaStatus.PROCESSING)
    if (isVideo && file.animation) await this.processAnimationVideo(file)
    else if (isVideo) await this.processVideo(file, trim)
    // GIF без ffmpeg — картинкой, как до перевода в MP4: показывается, только тяжелее.
    else if (isGif && ffmpeg) await this.processGif(file)
    else await this.processImage(file)
  }

  /** Копия вариантов `sourceId` для `fileId`. Источник не готов — обычная обработка. */
  async copy(sourceId: string, fileId: string): Promise<void> {
    const [source, target] = await Promise.all([
      this.prisma.file.findUnique({
        where: { id: sourceId },
        select: {
          bucket: true,
          width: true,
          height: true,
          placeholder: true,
          durationMs: true,
          mediaStatus: true,
          variants: { take: 16 },
        },
      }),
      this.prisma.file.findUnique({ where: { id: fileId }, select: SOURCE_SELECT }),
    ])
    if (!target) return
    if (!source || source.mediaStatus !== MediaStatus.READY) {
      await this.process(fileId)
      return
    }
    // Копия GIF чата (пересылка старого GIF, «Мои GIF» из него) переводится в MP4 сама: у
    // источника, обработанного картинкой, копировать нечего. Копия уже переведённого — MP4 и
    // сюда не попадает.
    if (this.isAnimationSource(target)) {
      if (target.mediaStatus !== MediaStatus.READY) await this.processSource(target)
      return
    }
    const from = variantPrefix(sourceId)
    const to = variantPrefix(fileId)
    const rename = (key: string) => `${to}${key.slice(from.length)}`

    // Сегменты HLS строк в БД не имеют — переносим всё содержимое префикса источника.
    const keys: string[] = []
    const stream = this.minio.listObjectsV2(source.bucket, from, true)
    for await (const obj of stream as AsyncIterable<{ name?: string }>) {
      if (obj.name) keys.push(obj.name)
    }
    for (const key of keys) {
      await this.minio.copyObject(target.bucket, rename(key), `/${source.bucket}/${key}`)
    }
    await this.persist(
      fileId,
      target.bucket,
      {
        width: source.width,
        height: source.height,
        placeholder: source.placeholder,
        durationMs: source.durationMs,
      },
      source.variants.map((v) => ({
        kind: v.kind,
        width: v.width,
        height: v.height,
        key: rename(v.key),
        mime: v.mime,
        size: v.size,
        bitrate: v.bitrate,
      })),
    )
  }

  /**
   * Исчерпаны попытки: показываем оригинал, как до медиа-системы. Всё, что неудачные попытки
   * успели залить под префикс вариантов (постер, часть сегментов HLS), убираем: строк у этих
   * объектов нет, а живой владелец не даёт ночной чистке счесть их сиротами. Готовый файл
   * (READY от параллельной копии) не трогаем.
   */
  async markFailed(fileId: string): Promise<void> {
    const { count } = await this.prisma.file.updateMany({
      where: { id: fileId, mediaStatus: { not: MediaStatus.READY } },
      data: { mediaStatus: MediaStatus.FAILED },
    })
    if (count === 0) return
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      select: { bucket: true },
    })
    if (file) await this.removePrefix(file.bucket, variantPrefix(fileId))
  }

  // ── Изображения ──

  private async processImage(file: SourceFile, bytes?: Buffer): Promise<void> {
    const input = bytes ?? (await this.readObject(file.bucket, file.key, MAX_IMAGE_BYTES))
    const result = await buildImageVariants(input, file.mime)
    const rows = await this.uploadImages(file, result.variants, MediaVariantKind.IMAGE)
    await this.persist(
      file.id,
      file.bucket,
      { width: result.width, height: result.height, placeholder: result.placeholder },
      rows,
    )
  }

  private async uploadImages(
    file: { id: string; bucket: string },
    variants: EncodedVariant[],
    kind: MediaVariantKind,
  ): Promise<VariantRow[]> {
    const rows: VariantRow[] = []
    for (const v of variants) {
      const key =
        kind === MediaVariantKind.POSTER
          ? posterVariantKey(file.id, v.width)
          : imageVariantKey(file.id, v.width)
      await this.minio.putObject(file.bucket, key, v.buffer, v.buffer.byteLength, {
        'Content-Type': 'image/webp',
        'Cache-Control': VARIANT_CACHE_CONTROL,
      })
      rows.push({
        kind,
        width: v.width,
        height: v.height,
        key,
        mime: 'image/webp',
        size: v.buffer.byteLength,
        bitrate: null,
      })
    }
    return rows
  }

  // ── Анимации (GIF как в Telegram) ──

  /**
   * GIF вложения чата → беззвучный MP4 + постер и LQIP. Запись File переключается на MP4
   * (ключ, mime, размер, `animation`) условно, по старому ключу: файл удалили или уже
   * переключили — новый объект убирается.
   *
   * Оригинал GIF не храним: MP4 легче в разы и показывает то же самое, а держать оба —
   * платить за GIF ради копии, которую никто не откроет. Объект GIF здесь не удаляется:
   * ссылки на него уже разосланы (сообщение ушло до перевода, подпись живёт до 15 минут), и
   * клиент, открывший чат минутой позже, ещё увидит GIF. Ничей объект снимет ночная
   * cleanOrphanFiles; если на него ссылается другая запись (сохранённый GIF, сид) — останется.
   *
   * GIF из одного кадра — картинка, а не анимация: обрабатывается как снимок.
   */
  private async processGif(file: SourceFile): Promise<void> {
    const input = await this.readObject(file.bucket, file.key, MAX_IMAGE_BYTES)
    const frames = await animationFrames(input)
    const plan = planAnimation(frames.width, frames.height, frames.frames, frames.delaysMs)
    if (!plan) {
      await this.processImage(file, input)
      return
    }
    await this.sweepStaleTmp(file.id)
    const dir = await mkdtemp(join(this.tmpRoot, `${file.id}-`))
    try {
      const gifPath = join(dir, 'source.gif')
      const outPath = join(dir, 'animation.mp4')
      await writeFile(gifPath, input)
      await transcodeAnimation({
        ffmpeg: this.ffmpeg,
        inputPath: gifPath,
        outPath,
        width: plan.width,
        height: plan.height,
        fps: plan.fps,
        maxSeconds: ANIMATION_MAX_SECONDS,
        crf: ANIMATION_CRF,
        timeoutMs: ANIMATION_TRANSCODE_MS,
      })
      const meta = await probe(this.ffprobe, outPath)
      const framePath = join(dir, 'poster.jpg')
      await extractFrame(this.ffmpeg, outPath, 0, framePath)
      const poster = await buildPosterVariants(await readFile(framePath))

      const key = `${randomUUID()}.mp4`
      const size = (await stat(outPath)).size
      await this.minio.fPutObject(file.bucket, key, outPath, { 'Content-Type': 'video/mp4' })
      const switched = await this.prisma.file.updateMany({
        where: { id: file.id, key: file.key },
        data: { key, mime: 'video/mp4', size, animation: true },
      })
      if (switched.count === 0) {
        await this.minio.removeObject(file.bucket, key).catch(() => undefined)
        return
      }
      const rows = await this.uploadImages(file, poster.variants, MediaVariantKind.POSTER)
      await this.persist(
        file.id,
        file.bucket,
        {
          width: meta.width || plan.width,
          height: meta.height || plan.height,
          durationMs: meta.durationMs,
          placeholder: poster.placeholder,
        },
        rows,
      )
      this.logger.log(
        `GIF ${file.id} переведён в MP4: ${input.byteLength} → ${size} байт, ${plan.width}×${plan.height}`,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  /**
   * Готовая MP4-анимация (GIPHY отдаёт её сам, или GIF уже переведён прошлой попыткой job'а):
   * только постер, LQIP и размеры. HLS анимации не нужен — ролик короткий, играет целиком по
   * кругу, а сегменты лишь добавили бы запросов.
   */
  private async processAnimationVideo(file: SourceFile): Promise<void> {
    const input = await this.minio.presignedGetObject(file.bucket, file.key, SOURCE_URL_TTL_SECONDS)
    const meta = await probe(this.ffprobe, input)
    if (meta.width === 0) {
      this.logger.warn(`Анимация ${file.id}: нет видеодорожки`)
      await this.setStatus(file.id, MediaStatus.FAILED)
      return
    }
    await this.sweepStaleTmp(file.id)
    const dir = await mkdtemp(join(this.tmpRoot, `${file.id}-`))
    try {
      const framePath = join(dir, 'poster.jpg')
      await extractFrame(this.ffmpeg, input, 0, framePath)
      const poster = await buildPosterVariants(await readFile(framePath))
      const rows = await this.uploadImages(file, poster.variants, MediaVariantKind.POSTER)
      await this.persist(
        file.id,
        file.bucket,
        {
          width: meta.width,
          height: meta.height,
          durationMs: meta.durationMs,
          placeholder: poster.placeholder,
        },
        rows,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  // ── Видео ──

  private async processVideo(source: SourceFile, trim?: VideoTrim): Promise<void> {
    let file = source
    // Отрезок вырезается первым, и дальше всё — постер, HLS, длительность — готовится уже из
    // него. Ключ сменился — отрезок вырезан прошлой попыткой job'а, резать второй раз нельзя.
    if (trim && file.key === trim.sourceKey) {
      const cut = await this.cutVideo(file, trim)
      if (!cut) return
      file = cut
    }
    // ffmpeg читает исходник по ссылке из внутреннего MinIO: 500 МБ не идут через память
    // воркера и не ложатся вторым экземпляром на диск — перекодирование потоковое.
    const input = await this.minio.presignedGetObject(file.bucket, file.key, SOURCE_URL_TTL_SECONDS)
    const meta = await probe(this.ffprobe, input)
    if (meta.width === 0 && meta.hasAudio) {
      // Только звук в контейнере webm/mp4 — голосовое чата: по сигнатуре такой контейнер не
      // отличить от видео, и mime у него video/*. Это не сбой: готовить нечего, играет
      // оригинал, как у любого не-медиа файла. Длительность пригодится плееру.
      await this.prisma.file.updateMany({
        where: { id: file.id },
        data: { mediaStatus: MediaStatus.NONE, durationMs: meta.durationMs },
      })
      return
    }
    if (meta.width === 0) {
      this.logger.warn(`Файл ${file.id}: ни видео-, ни звуковой дорожки — без HLS`)
      await this.setStatus(file.id, MediaStatus.FAILED)
      return
    }

    await this.sweepStaleTmp(file.id)
    const dir = await mkdtemp(join(this.tmpRoot, `${file.id}-`))
    try {
      const framePath = join(dir, 'poster.jpg')
      await extractFrame(this.ffmpeg, input, posterTimestamp(meta.durationMs), framePath)
      const poster = await buildPosterVariants(await readFile(framePath))
      const rows = await this.uploadImages(file, poster.variants, MediaVariantKind.POSTER)

      const renditions = planHlsLadder(meta.width, meta.height)
      const hlsDir = join(dir, 'hls')
      const seconds = (meta.durationMs ?? 0) / 1000
      await transcodeHls({
        ffmpeg: this.ffmpeg,
        input,
        outDir: hlsDir,
        renditions,
        hasAudio: meta.hasAudio,
        timeoutMs: Math.max(MIN_TRANSCODE_MS, seconds * TRANSCODE_SPEED_FACTOR * 1000),
      })
      for (const r of renditions) {
        const size = await this.uploadDir(
          join(hlsDir, String(r.short)),
          file.bucket,
          hlsRenditionDir(file.id, r.short),
        )
        rows.push({
          kind: MediaVariantKind.HLS,
          width: r.width,
          height: r.height,
          key: `${hlsRenditionDir(file.id, r.short)}index.m3u8`,
          mime: 'application/vnd.apple.mpegurl',
          size,
          bitrate: seconds > 0 ? Math.round((size * 8) / seconds) : null,
        })
      }
      await this.persist(
        file.id,
        file.bucket,
        {
          width: meta.width,
          height: meta.height,
          durationMs: meta.durationMs,
          placeholder: poster.placeholder,
        },
        rows,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  /**
   * Вырезать отрезок и подменить им исходник: новый объект под новым ключом, запись File
   * переключается на него, старый объект удаляется. В хранилище остаётся только отрезок —
   * его же играет оригинальная ссылка, пока не готов HLS. Переключение условное (по старому
   * ключу): файл удалили или уже переключили — новый объект убирается, обработка не идёт.
   */
  private async cutVideo(file: SourceFile, trim: VideoTrim): Promise<SourceFile | null> {
    const input = await this.minio.presignedGetObject(file.bucket, file.key, SOURCE_URL_TTL_SECONDS)
    await this.sweepStaleTmp(file.id)
    const dir = await mkdtemp(join(this.tmpRoot, `${file.id}-`))
    try {
      const outPath = join(dir, 'trim.mp4')
      const seconds = (trim.endMs - trim.startMs) / 1000
      await cutSegment({
        ffmpeg: this.ffmpeg,
        input,
        startMs: trim.startMs,
        endMs: trim.endMs,
        outPath,
        timeoutMs: Math.max(MIN_TRANSCODE_MS, seconds * TRANSCODE_SPEED_FACTOR * 1000),
      })
      const key = `${randomUUID()}.mp4`
      const size = (await stat(outPath)).size
      await this.minio.fPutObject(file.bucket, key, outPath, { 'Content-Type': 'video/mp4' })
      const switched = await this.prisma.file.updateMany({
        where: { id: file.id, key: file.key },
        data: { key, mime: 'video/mp4', size },
      })
      if (switched.count === 0) {
        await this.minio.removeObject(file.bucket, key).catch(() => undefined)
        return null
      }
      await this.minio.removeObject(file.bucket, file.key).catch((err: unknown) => {
        // Не мешает обработке: ничейный объект уберёт ночная cleanOrphanFiles.
        this.logger.warn(`Исходник ${file.id} не удалён после обрезки: ${String(err)}`)
      })
      this.logger.log(`Видео ${file.id} обрезано до ${seconds.toFixed(1)} с`)
      return { ...file, key, mime: 'video/mp4' }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  /** Заливает файлы каталога под префикс; возвращает суммарный размер. */
  private async uploadDir(local: string, bucket: string, prefix: string): Promise<number> {
    let total = 0
    for (const name of await readdir(local)) {
      const path = join(local, name)
      const ext = name.slice(name.lastIndexOf('.'))
      const size = (await stat(path)).size
      await this.minio.fPutObject(bucket, `${prefix}${name}`, path, {
        'Content-Type': HLS_CONTENT_TYPES[ext] ?? 'application/octet-stream',
        'Cache-Control': VARIANT_CACHE_CONTROL,
      })
      total += size
    }
    return total
  }

  // ── Общее ──

  private async readObject(bucket: string, key: string, limit: number): Promise<Buffer> {
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of await this.minio.getObject(bucket, key)) {
      const buf = chunk as Buffer
      total += buf.byteLength
      if (total > limit) throw new Error(`Объект ${bucket}/${key} больше ${limit} байт`)
      chunks.push(buf)
    }
    return Buffer.concat(chunks)
  }

  private async setStatus(fileId: string, mediaStatus: MediaStatus): Promise<void> {
    await this.prisma.file.updateMany({ where: { id: fileId }, data: { mediaStatus } })
  }

  /**
   * Варианты и статус — одной транзакцией: клиент не увидит READY без строк вариантов.
   * Файл удалили, пока шла обработка, — убираем уже залитые объекты и выходим молча.
   */
  private async persist(
    fileId: string,
    bucket: string,
    data: {
      width: number | null
      height: number | null
      placeholder: string | null
      durationMs?: number | null
    },
    rows: VariantRow[],
  ): Promise<void> {
    try {
      await this.prisma.$transaction([
        this.prisma.fileVariant.deleteMany({ where: { fileId } }),
        this.prisma.fileVariant.createMany({ data: rows.map((r) => ({ ...r, fileId })) }),
        this.prisma.file.update({
          where: { id: fileId },
          data: { ...data, mediaStatus: MediaStatus.READY, processedAt: new Date() },
        }),
      ])
    } catch (err) {
      const gone =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === 'P2025' || err.code === 'P2003')
      if (!gone) throw err
      await this.removePrefix(bucket, variantPrefix(fileId))
    }
  }

  private async removePrefix(bucket: string, prefix: string): Promise<void> {
    const keys: string[] = []
    const stream = this.minio.listObjectsV2(bucket, prefix, true)
    for await (const obj of stream as AsyncIterable<{ name?: string }>) {
      if (obj.name) keys.push(obj.name)
    }
    if (keys.length > 0) await this.minio.removeObjects(bucket, keys)
  }
}
