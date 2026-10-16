import sharp from 'sharp'
import { IMAGE_WEBP_QUALITY, PLACEHOLDER_SIZE, PLACEHOLDER_WEBP_QUALITY } from './media.constants'
import { planImageWidths, planPosterWidths } from './media-plan'

export interface EncodedVariant {
  width: number
  height: number
  buffer: Buffer
}

export interface ImagePipelineResult {
  /** Размеры оригинала после поворота по EXIF. */
  width: number
  height: number
  /** LQIP: data-URI крошечной WebP-копии. */
  placeholder: string
  variants: EncodedVariant[]
}

// Потолок декодируемых пикселей: 100 Мп с запасом покрывают любую камеру телефона, а
// «бомба» из PNG 30000×30000 (сжатый файл в килобайты) упирается в него, а не в память.
const LIMIT_INPUT_PIXELS = 100_000_000

function open(input: Buffer) {
  // `rotate()` без аргументов кладёт кадр по EXIF Orientation. Метаданные sharp по
  // умолчанию не переносит (нет `withMetadata`), поэтому EXIF вместе с GPS из копий
  // уходит — оригинал при этом не трогаем, он остаётся тем, что загрузил человек.
  // `failOn: 'none'` — недокачанный хвост JPEG не повод отказать в превью.
  return sharp(input, { failOn: 'none', limitInputPixels: LIMIT_INPUT_PIXELS }).rotate()
}

async function encodePlaceholder(input: Buffer): Promise<string> {
  const buf = await open(input)
    .resize(PLACEHOLDER_SIZE, PLACEHOLDER_SIZE, { fit: 'inside' })
    .webp({ quality: PLACEHOLDER_WEBP_QUALITY })
    .toBuffer()
  return `data:image/webp;base64,${buf.toString('base64')}`
}

async function encodeWidths(input: Buffer, widths: number[]): Promise<EncodedVariant[]> {
  const out: EncodedVariant[] = []
  // Последовательно, а не Promise.all: каждая ступень держит декодированный кадр в памяти,
  // а параллельность уже даёт конкурентность воркера.
  for (const width of widths) {
    const { data, info } = await open(input)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: IMAGE_WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true })
    out.push({ width: info.width, height: info.height, buffer: data })
  }
  return out
}

async function orientedSize(input: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(input, { limitInputPixels: LIMIT_INPUT_PIXELS }).metadata()
  const w = meta.width ?? 0
  const h = meta.height ?? 0
  // Orientation 5–8 — кадр повёрнут на 90°: стороны меняются местами.
  return (meta.orientation ?? 1) >= 5 ? { width: h, height: w } : { width: w, height: h }
}

/**
 * Варианты изображения: уменьшенные WebP-копии и LQIP.
 *
 * GIF получает только заглушку: копия была бы первым кадром, а показывать гифку надо
 * анимированной — значит, оригиналом.
 */
export async function buildImageVariants(
  input: Buffer,
  mime: string,
): Promise<ImagePipelineResult> {
  const { width, height } = await orientedSize(input)
  const widths = mime === 'image/gif' ? [] : planImageWidths(width, mime === 'image/webp')
  const [placeholder, variants] = await Promise.all([
    encodePlaceholder(input),
    encodeWidths(input, widths),
  ])
  return { width, height, placeholder, variants }
}

/** Постер видео из кадра (JPEG от ffmpeg): ступени WebP и LQIP. */
export async function buildPosterVariants(frame: Buffer): Promise<ImagePipelineResult> {
  const { width, height } = await orientedSize(frame)
  const [placeholder, variants] = await Promise.all([
    encodePlaceholder(frame),
    encodeWidths(frame, planPosterWidths(width)),
  ])
  return { width, height, placeholder, variants }
}
