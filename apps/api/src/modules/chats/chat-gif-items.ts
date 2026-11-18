import type { Prisma } from '@prisma/client'
import { signingWindow } from '../../common/minio/stable-sign'
import type { FileService } from '../files/file.service'
import type { MediaService } from '../media/media.service'
import { MEDIA_FILE_SELECT } from '../media/media.types'

// GIF в панели поля ввода — «Сохранённые» и «Недавние»: файл чата с подписанной ссылкой.
// Одна форма на оба раздела: клиент рисует плитку одинаково, а отправляет по fileId
// (`POST /chats/:id/gif`).

/** Поля файла, из которых собирается плитка GIF. */
export const GIF_FILE_SELECT = {
  ...MEDIA_FILE_SELECT,
  size: true,
  animation: true,
} satisfies Prisma.FileSelect

export type GifFileRow = Prisma.FileGetPayload<{ select: typeof GIF_FILE_SELECT }>

/** Это GIF: старый image/gif или переведённый в MP4 (анимация). */
export const GIF_FILE_WHERE = {
  OR: [{ mime: 'image/gif' }, { animation: true }],
} satisfies Prisma.FileWhereInput

export function isGifFile(file: { mime: string; animation: boolean }): boolean {
  return file.mime === 'image/gif' || file.animation
}

/**
 * Отпечаток содержимого `<size>:<width>:<height>`. Каждая пересылка GIF — новая запись File
 * на новый ключ, и «тот же» GIF лежит несколькими записями; у одинаковых байтов эти три
 * числа совпадают, а у разных GIF совпасть всем трём почти невозможно.
 */
export function gifFingerprint(file: {
  size: number
  width: number | null
  height: number | null
}): string {
  return `${file.size}:${file.width ?? ''}:${file.height ?? ''}`
}

export interface GifItemDto {
  fileId: string
  /** image/gif — старый GIF (рисуется <img>), video/mp4 с `animation` — MP4 по кругу. */
  mime: string
  animation: boolean
  width: number | null
  height: number | null
  url: string
  /** Постер MP4 (самая лёгкая копия) — до первого кадра и при «уменьшении движения». */
  poster: string | null
  placeholder: string | null
  expiresAt: string
  /** Отпечаток содержимого (`gifFingerprint`): клиент не показывает недавний, если он сохранён. */
  fingerprint: string
}

/** Плитки GIF по строкам файлов; файл без ссылки (объект пропал) пропускается. */
export async function toGifItems(
  rows: GifFileRow[],
  files: FileService,
  media: MediaService,
  now = Date.now(),
): Promise<Map<string, GifItemDto>> {
  const [urls, described] = await Promise.all([
    files.getPresignedUrls(rows.map((row) => row.id)),
    media.describe(rows, now),
  ])
  const expiresAt = signingWindow(now).expiresAt.toISOString()
  const out = new Map<string, GifItemDto>()
  for (const row of rows) {
    const url = urls.get(row.id)
    if (!url) continue
    out.set(row.id, {
      fileId: row.id,
      mime: row.mime,
      animation: row.animation,
      width: row.width,
      height: row.height,
      url,
      poster: described.get(row.id)?.poster[0]?.url ?? null,
      placeholder: row.placeholder,
      expiresAt,
      fingerprint: gifFingerprint(row),
    })
  }
  return out
}
