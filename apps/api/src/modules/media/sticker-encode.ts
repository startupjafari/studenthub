import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp, { type Metadata, type OutputInfo } from 'sharp'
import { USER_STICKER_LIMITS } from '@studenthub/shared-schemas'
import { run } from './ffmpeg'

// Нормализация своих стикеров (docs/PROJECT.md «Свои стикеры»): что бы ни прислал человек —
// фото, скриншот, GIF или кусок видео, — на выходе WebP как у Telegram: большая сторона
// 512 px, прозрачность сохраняется, ≤ 512 КБ. Анимация — анимированный WebP ≤ 3 с,
// ≤ 30 кадров/с, без звука: его играют браузеры, iOS 14+ и Android, а WebM на iOS через
// AVPlayer не играет.
//
// Статика кодируется sharp прямо в запросе (доли секунды), анимация — ffmpeg в медиа-воркере
// (StickerProcessingService): перекодирование видео не должно держать HTTP-запрос.

const { SIDE_PX, MAX_BYTES, ANIMATION_MAX_MS, ANIMATION_MAX_FPS } = USER_STICKER_LIMITS

/** Почему исходник не годится: клиенту уходит STICKER_SOURCE_INVALID. */
export type StickerSourceProblem = 'type' | 'pixels' | 'frames' | 'decode' | 'heavy'

export class StickerSourceError extends Error {
  constructor(readonly problem: StickerSourceProblem) {
    super(`Исходник стикера не годится: ${problem}`)
    this.name = 'StickerSourceError'
  }
}

/**
 * Потолок пикселей статичного исходника. 50 Мп покрывают любой снимок телефона, а «бомба»
 * из PNG 30000×30000 (сжатый файл в килобайты) упирается в потолок, а не в память.
 */
export const STATIC_MAX_PIXELS = 50_000_000
/** Потолок кадра анимации: 4096×4096 — больше 4K-видео, но не «бомба» из GIF. */
export const FRAME_MAX_PIXELS = 4096 * 4096
/** Потолок кадров анимированного WebP на входе: 3 с при 30 к/с — 90, запас на длинный файл. */
export const WEBP_INPUT_MAX_FRAMES = 1000
/** Сколько ffmpeg может кодировать одну попытку: 3 с анимации — секунды, остальное запас. */
const FFMPEG_TIMEOUT_MS = 90_000

/** Ступени качества статичного WebP: первая, что уложилась в 512 КБ. */
const STATIC_QUALITY_STEPS = [90, 80, 70, 60, 50, 40, 30] as const
/**
 * Ступени анимации: сперва качество, потом частота кадров. 10 к/с при качестве 25 — уже
 * последняя разумная ступень; не уложились — исходник «слишком тяжёлый» для стикера.
 */
const ANIMATION_STEPS = [
  { fps: 30, quality: 75 },
  { fps: 24, quality: 65 },
  { fps: 20, quality: 55 },
  { fps: 15, quality: 45 },
  { fps: 12, quality: 35 },
  { fps: 10, quality: 25 },
] as const

export type StickerSourceKind = 'png' | 'jpeg' | 'webp' | 'gif' | 'mp4' | 'webm'

/**
 * Тип исходника по первым байтам (magic bytes), а не по имени и не по заявленному типу.
 * HEIC проект не принимает нигде — здесь тоже: браузер, который его открывает (Safari),
 * присылает уже PNG из редактора.
 */
export function sniffStickerSource(buf: Buffer): StickerSourceKind | null {
  if (buf.length < 12) return null
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png'
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp'
  }
  const gif = buf.toString('ascii', 0, 6)
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'gif'
  // ISO BMFF: mp4 и mov (QuickTime) — `ftyp` с четвёртого байта.
  if (buf.toString('ascii', 4, 8) === 'ftyp') return 'mp4'
  // EBML: WebM и Matroska.
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm'
  return null
}

/** Стороны стикера: большая — ровно 512 px, пропорция исходника. */
export function fitStickerSide(width: number, height: number): { width: number; height: number } {
  const k = SIDE_PX / Math.max(width, height, 1)
  return {
    width: Math.max(1, Math.round(width * k)),
    height: Math.max(1, Math.round(height * k)),
  }
}

export interface EncodedSticker {
  buffer: Buffer
  width: number
  height: number
  animated: boolean
}

/** Кадрирование долями кадра (0…1), как присылает клиент. */
export interface CropFraction {
  x: number
  y: number
  w: number
  h: number
}

/** Кадрирование в пикселях кадра шириной `width` и высотой `height`; всегда ≥ 1×1 внутри. */
export function cropToPixels(
  crop: CropFraction | undefined,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  if (!crop) return { left: 0, top: 0, width, height }
  const left = Math.min(width - 1, Math.max(0, Math.round(crop.x * width)))
  const top = Math.min(height - 1, Math.max(0, Math.round(crop.y * height)))
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.round(crop.w * width))),
    height: Math.max(1, Math.min(height - top, Math.round(crop.h * height))),
  }
}

/** Анимирован ли WebP (несколько кадров). Битый файл — ошибка decode. */
export async function isAnimatedWebp(input: Buffer): Promise<boolean> {
  try {
    const meta = await sharp(input, { limitInputPixels: false }).metadata()
    return (meta.pages ?? 1) > 1
  } catch {
    throw new StickerSourceError('decode')
  }
}

/**
 * Статичный стикер: поворот по EXIF, большая сторона → 512 px (меньшие картинки
 * растягиваются — стикеры в чате одного размера), WebP с альфа-каналом. Качество снижается
 * ступенями, пока файл не уложится в 512 КБ. Анимированный исходник сюда не приходит —
 * у GIF и анимированного WebP взялся бы только первый кадр.
 */
export async function encodeStaticSticker(input: Buffer): Promise<EncodedSticker> {
  let meta: Metadata
  try {
    meta = await sharp(input, { limitInputPixels: false }).metadata()
  } catch {
    throw new StickerSourceError('decode')
  }
  if (!meta.width || !meta.height) throw new StickerSourceError('decode')
  if (meta.width * meta.height > STATIC_MAX_PIXELS) throw new StickerSourceError('pixels')

  // Раскладка в 512 px — один раз, в «сырые» пиксели: ступени качества кодируют уже их.
  let raw: { data: Buffer; info: OutputInfo }
  try {
    raw = await sharp(input, { failOn: 'none', limitInputPixels: STATIC_MAX_PIXELS })
      .rotate()
      .resize(SIDE_PX, SIDE_PX, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
  } catch {
    throw new StickerSourceError('decode')
  }
  const { width, height, channels } = raw.info
  for (const quality of STATIC_QUALITY_STEPS) {
    const buffer = await sharp(raw.data, { raw: { width, height, channels } })
      .webp({ quality, alphaQuality: 90, effort: 4 })
      .toBuffer()
    if (buffer.byteLength <= MAX_BYTES) return { buffer, width, height, animated: false }
  }
  throw new StickerSourceError('heavy')
}

export interface AnimatedParams {
  startMs: number
  durationMs: number
  crop?: CropFraction
  /** Прозрачный PNG поверх (надпись), растягивается в размер итогового стикера. */
  overlay?: Buffer
}

/**
 * Анимированный WebP на входе (чужой стикер, анимация с телефона) — через sharp: ffmpeg до
 * 8.0 анимированный WebP не декодирует. Берутся кадры выбранного отрезка, большая сторона
 * → 512 px. Кадрирование и надпись здесь не применяются (обрезать многостраничную картинку
 * sharp по кадрам не умеет) — клиент для такого исходника их не предлагает.
 */
export async function encodeAnimatedWebpSticker(
  input: Buffer,
  params: Pick<AnimatedParams, 'startMs' | 'durationMs'>,
): Promise<EncodedSticker> {
  let meta: Metadata
  try {
    meta = await sharp(input, { animated: true, limitInputPixels: false }).metadata()
  } catch {
    throw new StickerSourceError('decode')
  }
  const pages = meta.pages ?? 1
  const frameHeight = meta.pageHeight ?? meta.height ?? 0
  if (!meta.width || !frameHeight) throw new StickerSourceError('decode')
  if (meta.width * frameHeight > FRAME_MAX_PIXELS) throw new StickerSourceError('pixels')
  if (pages > WEBP_INPUT_MAX_FRAMES) throw new StickerSourceError('frames')

  const { first, count } = pickFrames(meta.delay ?? [], pages, params.startMs, params.durationMs)
  const delays = (meta.delay ?? []).slice(first, first + count)
  const { width, height } = fitStickerSide(meta.width, frameHeight)
  for (const step of ANIMATION_STEPS) {
    let buffer: Buffer
    try {
      buffer = await sharp(input, {
        animated: true,
        page: first,
        pages: count,
        limitInputPixels: FRAME_MAX_PIXELS * count,
      })
        .resize(width, height, { fit: 'fill' })
        .webp({
          quality: step.quality,
          alphaQuality: 80,
          effort: 4,
          loop: 0,
          ...(delays.length === count ? { delay: delays } : {}),
        })
        .toBuffer()
    } catch {
      throw new StickerSourceError('decode')
    }
    if (buffer.byteLength <= MAX_BYTES) return { buffer, width, height, animated: count > 1 }
  }
  throw new StickerSourceError('heavy')
}

/**
 * Какие кадры анимации попадают в отрезок [startMs, startMs + durationMs). Задержки кадров
 * неизвестны — берём первые кадры при 10 к/с (обычный темп GIF).
 */
export function pickFrames(
  delays: number[],
  pages: number,
  startMs: number,
  durationMs: number,
): { first: number; count: number } {
  const span = Math.min(durationMs, ANIMATION_MAX_MS)
  const delayOf = (i: number): number => {
    const d = delays[i]
    // Нулевая и слишком малая задержка браузеры показывают как 100 мс — считаем так же.
    return d !== undefined && d >= 20 ? d : 100
  }
  let t = 0
  let first = 0
  while (first < pages - 1 && t + delayOf(first) <= startMs) {
    t += delayOf(first)
    first += 1
  }
  let count = 0
  let elapsed = 0
  while (first + count < pages && elapsed < span) {
    elapsed += delayOf(first + count)
    count += 1
  }
  return { first, count: Math.max(1, count) }
}

interface ProbeJson {
  streams?: {
    codec_type?: string
    width?: number
    height?: number
    r_frame_rate?: string
    avg_frame_rate?: string
    tags?: { rotate?: string }
    side_data_list?: { rotation?: number }[]
  }[]
  format?: { duration?: string }
}

export interface AnimationProbe {
  width: number
  height: number
  durationMs: number | null
  fps: number | null
}

// Контейнеры по белому списку (как в ffmpeg.ts, F-F26) плюс `gif`: исходник стикера бывает
// GIF. Протоколы — только те, которыми читается сам вход: ссылка MinIO или локальный файл.
const STICKER_DEMUXERS = 'gif,mov,matroska'

function stickerInputArgs(input: string): string[] {
  const remote = /^https?:\/\//.test(input)
  return [
    '-protocol_whitelist',
    remote ? 'http,https,tcp,tls' : 'file',
    '-format_whitelist',
    STICKER_DEMUXERS,
    ...(remote ? ['-reconnect', '1', '-reconnect_on_network_error', '1'] : []),
    '-i',
    input,
  ]
}

function parseRate(rate: string | undefined): number | null {
  if (!rate) return null
  const [num, den] = rate.split('/').map(Number)
  if (!num || !den) return null
  const fps = num / den
  return Number.isFinite(fps) && fps > 0 ? fps : null
}

/** Размер кадра (с поворотом), длительность и частота кадров GIF или видео. */
export async function probeAnimation(ffprobe: string, input: string): Promise<AnimationProbe> {
  let out: string
  try {
    out = await run(
      ffprobe,
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_streams',
        '-show_format',
        ...stickerInputArgs(input),
      ],
      60_000,
    )
  } catch {
    throw new StickerSourceError('decode')
  }
  const json = JSON.parse(out) as ProbeJson
  const video = json.streams?.find((s) => s.codec_type === 'video')
  if (!video?.width || !video.height) throw new StickerSourceError('decode')
  const rotation = Math.abs(
    video.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation ??
      Number(video.tags?.rotate ?? 0),
  )
  const quarter = rotation % 180 === 90
  const seconds = Number(json.format?.duration)
  return {
    width: quarter ? video.height : video.width,
    height: quarter ? video.width : video.height,
    durationMs: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null,
    fps: parseRate(video.avg_frame_rate) ?? parseRate(video.r_frame_rate),
  }
}

/** Отрезок, который реально кодируем: внутри ролика и не длиннее 3 с. */
export function clampSegment(
  startMs: number,
  durationMs: number,
  totalMs: number | null,
): { startMs: number; durationMs: number } {
  const want = Math.min(Math.max(durationMs, 1), ANIMATION_MAX_MS)
  if (totalMs === null) return { startMs: Math.max(0, startMs), durationMs: want }
  const start = Math.min(Math.max(0, startMs), Math.max(0, totalMs - 100))
  return { startMs: start, durationMs: Math.max(1, Math.min(want, totalMs - start)) }
}

/**
 * GIF или видео → анимированный WebP через ffmpeg (libwebp_anim). Один проход на ступень:
 * отрезок, частота кадров, кадрирование, масштаб 512 px, надпись поверх, без звука. Ступени
 * снижают качество и частоту, пока файл не уложится в 512 КБ.
 *
 * `input` — путь к временному файлу или подписанная ссылка на объект во внутреннем MinIO;
 * `workDir` — временный каталог вызывающего (он же его и удаляет).
 */
export async function encodeAnimatedSticker(params: {
  ffmpeg: string
  ffprobe: string
  input: string
  kind: 'gif' | 'video'
  workDir: string
  animation: AnimatedParams
}): Promise<EncodedSticker> {
  const probe = await probeAnimation(params.ffprobe, params.input)
  if (probe.width * probe.height > FRAME_MAX_PIXELS) throw new StickerSourceError('pixels')
  const segment = clampSegment(
    params.animation.startMs,
    params.animation.durationMs,
    probe.durationMs,
  )
  const crop = cropToPixels(params.animation.crop, probe.width, probe.height)
  const out = fitStickerSide(crop.width, crop.height)

  let overlayPath: string | null = null
  if (params.animation.overlay) {
    overlayPath = join(params.workDir, 'overlay.png')
    try {
      // Надпись приводим к размеру стикера сами: размер PNG от клиента не доверяем.
      const png = await sharp(params.animation.overlay, { limitInputPixels: STATIC_MAX_PIXELS })
        .resize(out.width, out.height, { fit: 'fill' })
        .ensureAlpha()
        .png()
        .toBuffer()
      await writeFile(overlayPath, png)
    } catch {
      throw new StickerSourceError('decode')
    }
  }

  const sourceFps = probe.fps ?? ANIMATION_MAX_FPS
  const outPath = join(params.workDir, 'sticker.webp')
  // Видео — быстрый переход до -i (точный при перекодировании); у GIF перехода по времени
  // нет — пропускаем кадры уже после декодирования.
  const seek = (segment.startMs / 1000).toFixed(3)
  for (const step of ANIMATION_STEPS) {
    const fps = Math.min(step.fps, sourceFps, ANIMATION_MAX_FPS)
    const base =
      `[0:v]fps=${fps.toFixed(3)},` +
      `crop=${crop.width}:${crop.height}:${crop.left}:${crop.top},` +
      `scale=${out.width}:${out.height}:flags=lanczos,format=rgba`
    const graph = overlayPath
      ? `${base}[v];[1:v]format=rgba[o];[v][o]overlay=0:0:format=auto,format=yuva420p[out]`
      : `${base},format=yuva420p[out]`
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...(params.kind === 'video' ? ['-ss', seek] : []),
      ...stickerInputArgs(params.input),
      ...(overlayPath
        ? ['-protocol_whitelist', 'file', '-format_whitelist', 'png_pipe,image2', '-i', overlayPath]
        : []),
      ...(params.kind === 'gif' ? ['-ss', seek] : []),
      '-t',
      (segment.durationMs / 1000).toFixed(3),
      '-filter_complex',
      graph,
      '-map',
      '[out]',
      '-an',
      '-c:v',
      'libwebp_anim',
      '-lossless',
      '0',
      '-quality',
      String(step.quality),
      '-compression_level',
      '4',
      '-loop',
      '0',
      outPath,
    ]
    try {
      await run(params.ffmpeg, args, FFMPEG_TIMEOUT_MS)
    } catch {
      throw new StickerSourceError('decode')
    }
    const buffer = await readFile(outPath)
    if (buffer.byteLength <= MAX_BYTES) {
      return { buffer, width: out.width, height: out.height, animated: true }
    }
  }
  throw new StickerSourceError('heavy')
}
