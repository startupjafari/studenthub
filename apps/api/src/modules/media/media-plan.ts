import { HLS_LADDER, IMAGE_WIDTHS, POSTER_WIDTHS } from './media.constants'

// Чистые расчёты медиа-конвейера: что генерировать для данного оригинала. Отдельно от
// sharp/ffmpeg, чтобы правила «не больше исходного» проверялись тестом без бинарников.

/**
 * Ширины уменьшенных копий изображения. Копия имеет смысл, только если она хотя бы на 15%
 * у́же оригинала: иначе это перекодирование того же размера ради нескольких процентов байт.
 * Исключение — оригинал не в WebP и уже́ самой малой ступени: ему одна копия той же ширины,
 * потому что PNG-скриншот в WebP легче в разы, а показывают его так же часто.
 */
export function planImageWidths(width: number, sourceIsWebp: boolean): number[] {
  const widths: number[] = IMAGE_WIDTHS.filter((w) => w <= width * 0.85)
  if (widths.length === 0 && !sourceIsWebp && width > 0) return [width]
  return widths
}

/** Ширины постера видео: ступени уже кадра плюс сам кадр, если он уже самой крупной. */
export function planPosterWidths(width: number): number[] {
  const widths: number[] = POSTER_WIDTHS.filter((w) => w < width)
  const largest = POSTER_WIDTHS[POSTER_WIDTHS.length - 1] ?? 0
  if (width > 0 && width <= largest) widths.push(width)
  return widths
}

export interface HlsRendition {
  /** Ступень лесенки (короткая сторона), она же имя каталога рендишна. */
  short: number
  width: number
  height: number
  videoKbps: number
  audioKbps: number
}

/** Ближайшее чётное: H.264 с yuv420p требует чётных сторон кадра. */
function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2)
}

/**
 * Лесенка рендишнов для кадра `width × height` (уже с учётом поворота).
 *
 * Ступени — только в пределах исходного разрешения по короткой стороне. Ролик меньше
 * нижней ступени получает один рендишн своего размера: HLS ему нужен ради единого пути
 * воспроизведения и сегментной докачки, а не ради выбора качества.
 */
export function planHlsLadder(width: number, height: number): HlsRendition[] {
  if (width <= 0 || height <= 0) return []
  const portrait = height > width
  const short = Math.min(width, height)
  const scale = (s: number) => {
    const long = even(((portrait ? height : width) * s) / short)
    const side = even(s)
    return portrait ? { width: side, height: long } : { width: long, height: side }
  }
  const rungs = HLS_LADDER.filter((r) => r.short <= short)
  if (rungs.length === 0) {
    const lowest = HLS_LADDER[0]
    return [
      {
        short,
        ...scale(short),
        videoKbps: lowest.videoKbps,
        audioKbps: lowest.audioKbps,
      },
    ]
  }
  return rungs.map((r) => ({ ...r, ...scale(r.short) }))
}

/** Момент кадра для постера: секунда от начала, но не дальше середины короткого ролика. */
export function posterTimestamp(durationMs: number | null): number {
  if (!durationMs || durationMs <= 0) return 0
  return Math.min(1, durationMs / 2000)
}
