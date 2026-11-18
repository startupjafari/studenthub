import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { MediaStatus } from '@prisma/client'
import type { Client as MinioClient } from 'minio'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { USER_STICKER_LIMITS } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { MINIO_CLIENT } from '../../common/minio/minio.constants'
import type { EnvVars } from '../../config/env.schema'
import { isAvailable } from './ffmpeg'
import {
  StickerSourceError,
  encodeAnimatedSticker,
  encodeAnimatedWebpSticker,
  type CropFraction,
  type EncodedSticker,
} from './sticker-encode'

/**
 * Job `build-sticker` очереди media-video (MEDIA_JOBS.STICKER): собрать анимированный стикер
 * личного набора. Ставит ChatStickersService, разбирает воркер (или API в inline-режиме).
 * Поля — строки, как у остальных медиа-job'ов.
 */
export interface StickerJobData {
  stickerId: string
  ownerId: string
  /** Исходник — объект во внутреннем MinIO: временная загрузка или вложение переписки. */
  sourceBucket: string
  sourceKey: string
  /** '1' — исходник временный (загрузка с устройства): убирается после сборки. */
  sourceTemp?: string
  kind: 'gif' | 'video' | 'webp'
  startMs: string
  durationMs: string
  /** Кадрирование долями «x,y,w,h». */
  crop?: string
  /** Временный объект с PNG-надписью поверх. */
  overlayKey?: string
}

// Ссылка, по которой ffmpeg читает исходник: сборка стикера — секунды, час — с запасом.
const SOURCE_URL_TTL_SECONDS = 60 * 60
const TMP_DIR_NAME = 'studenthub-stickers'
// Потолок чтения в память: анимированный WebP и надпись приходят с устройства (≤ 10 МБ).
const MAX_READ_BYTES = USER_STICKER_LIMITS.SOURCE_MAX_BYTES + 1024 * 1024

function parseCrop(raw: string | undefined): CropFraction | undefined {
  if (!raw) return undefined
  const [x, y, w, h] = raw.split(',').map(Number)
  if (![x, y, w, h].every((n) => n !== undefined && Number.isFinite(n))) return undefined
  return { x: x!, y: y!, w: w!, h: h! }
}

/**
 * Сборка анимированных стикеров в медиа-воркере (docs/PROJECT.md «Свои стикеры»).
 *
 * Идемпотентно: стикер собирается, только пока он PROCESSING; итог пишется условной записью
 * (тот же статус), и повтор job'а после падения ничего не задваивает. Исходник «не годится»
 * (StickerSourceError) — стикер сразу FAILED, без повторов: второй раз тот же файл лучше не
 * станет. Прочие сбои (MinIO, БД) пробрасываются — BullMQ повторит, а исчерпанные попытки
 * переводят стикер в FAILED (MediaVideoProcessor.onFailed).
 */
@Injectable()
export class StickerProcessingService {
  private readonly logger = new Logger(StickerProcessingService.name)
  private readonly ffmpeg: string
  private readonly ffprobe: string
  private readonly tmpRoot: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvVars, true>,
    @Inject(MINIO_CLIENT) private readonly minio: MinioClient,
  ) {
    this.ffmpeg = this.config.get('FFMPEG_PATH', { infer: true })
    this.ffprobe = this.config.get('FFPROBE_PATH', { infer: true })
    this.tmpRoot = join(this.config.get('MEDIA_TMP_DIR', { infer: true }) ?? tmpdir(), TMP_DIR_NAME)
  }

  async build(data: StickerJobData): Promise<void> {
    const sticker = await this.prisma.sticker.findUnique({
      where: { id: data.stickerId },
      select: { status: true },
    })
    if (!sticker || sticker.status !== MediaStatus.PROCESSING) {
      await this.cleanup(data)
      return
    }
    if (data.kind !== 'webp') {
      const ready = (await isAvailable(this.ffmpeg)) && (await isAvailable(this.ffprobe))
      // Неготовность окружения — не беда файла: пусть BullMQ повторит.
      if (!ready) throw new Error(`ffmpeg/ffprobe недоступны (${this.ffmpeg}, ${this.ffprobe})`)
    }

    await mkdir(this.tmpRoot, { recursive: true })
    const workDir = await mkdtemp(join(this.tmpRoot, `${data.stickerId}-`))
    let encoded: EncodedSticker
    try {
      encoded = await this.encode(data, workDir)
    } catch (error) {
      if (error instanceof StickerSourceError) {
        this.logger.warn(`Стикер ${data.stickerId}: исходник не годится (${error.problem})`)
        await this.markFailed(data.stickerId)
        await this.cleanup(data)
        return
      }
      throw error
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
    await this.store(data, encoded)
    await this.cleanup(data)
  }

  /** Попытки кончились или исходник не годится: стикер FAILED (видит только владелец). */
  async markFailed(stickerId: string): Promise<void> {
    await this.prisma.sticker.updateMany({
      where: { id: stickerId, status: MediaStatus.PROCESSING },
      data: { status: MediaStatus.FAILED },
    })
  }

  /** Убрать временные объекты job'а (исходник с устройства и надпись). */
  async cleanup(data: StickerJobData): Promise<void> {
    const keys = [data.sourceTemp === '1' ? data.sourceKey : null, data.overlayKey ?? null]
    for (const key of keys) {
      if (!key) continue
      await this.minio.removeObject(data.sourceBucket, key).catch(() => undefined)
    }
  }

  private async encode(data: StickerJobData, workDir: string): Promise<EncodedSticker> {
    const animation = {
      startMs: Number(data.startMs) || 0,
      durationMs: Number(data.durationMs) || USER_STICKER_LIMITS.ANIMATION_MAX_MS,
    }
    if (data.kind === 'webp') {
      const input = await this.readObject(data.sourceBucket, data.sourceKey)
      return encodeAnimatedWebpSticker(input, animation)
    }
    const overlay = data.overlayKey
      ? await this.readObject(data.sourceBucket, data.overlayKey)
      : undefined
    const input = await this.minio.presignedGetObject(
      data.sourceBucket,
      data.sourceKey,
      SOURCE_URL_TTL_SECONDS,
    )
    return encodeAnimatedSticker({
      ffmpeg: this.ffmpeg,
      ffprobe: this.ffprobe,
      input,
      kind: data.kind,
      workDir,
      animation: { ...animation, crop: parseCrop(data.crop), overlay },
    })
  }

  /**
   * Готовый стикер: объект в бакете чатов, запись File (без вариантов — стикер показывается
   * как есть) и условный перевод PROCESSING → READY. Стикер удалили или он уже не в работе —
   * свой объект и запись убираем.
   */
  private async store(data: StickerJobData, encoded: EncodedSticker): Promise<void> {
    const key = `${randomUUID()}.webp`
    const size = encoded.buffer.byteLength
    await this.minio.putObject(data.sourceBucket, key, encoded.buffer, size, {
      'Content-Type': 'image/webp',
    })
    const file = await this.prisma.file.create({
      data: {
        bucket: data.sourceBucket,
        key,
        mime: 'image/webp',
        size,
        ownerId: data.ownerId,
        width: encoded.width,
        height: encoded.height,
        name: 'sticker.webp',
        mediaStatus: MediaStatus.NONE,
      },
      select: { id: true },
    })
    const { count } = await this.prisma.sticker.updateMany({
      where: { id: data.stickerId, status: MediaStatus.PROCESSING },
      data: {
        fileId: file.id,
        status: MediaStatus.READY,
        width: encoded.width,
        height: encoded.height,
        animated: encoded.animated,
      },
    })
    if (count === 0) {
      await this.prisma.file.delete({ where: { id: file.id } }).catch(() => undefined)
      await this.minio.removeObject(data.sourceBucket, key).catch(() => undefined)
      return
    }
    this.logger.log(`Стикер ${data.stickerId} собран: ${size} байт`)
  }

  private async readObject(bucket: string, key: string): Promise<Buffer> {
    const stream = await this.minio.getObject(bucket, key)
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of stream) {
      total += (chunk as Buffer).byteLength
      if (total > MAX_READ_BYTES) {
        stream.destroy()
        throw new StickerSourceError('pixels')
      }
      chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks)
  }
}
