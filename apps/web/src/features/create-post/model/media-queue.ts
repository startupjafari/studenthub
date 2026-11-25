/**
 * Чистая часть очереди вложений редактора поста: проверки и перестановка. Отдельно от
 * хука — чтобы порядок и отбор файлов проверялись тестами без DOM и сети.
 */

export const MAX_POST_MEDIA = 10

export type ComposerMediaStatus = 'uploading' | 'done' | 'error'

export interface ComposerMedia {
  /** Локальный ключ строки: id файла появляется только после загрузки. */
  key: string
  file: File
  /** object-URL для превью — освобождается при удалении и размонтировании. */
  previewUrl: string
  isVideo: boolean
  status: ComposerMediaStatus
  /** 0…100. */
  progress: number
  fileId?: string
  /** Код ошибки API (`FILE_TOO_LARGE`, `NETWORK_ERROR`…) — для текста по i18n. */
  errorCode?: string
}

export type RejectReason = 'type' | 'size' | 'limit'

/** Фото и видео — то, что принимает бакет постов; остальное отклоняется до загрузки. */
export function isPostMediaFile(file: File): boolean {
  return file.type.startsWith('image/') || file.type.startsWith('video/')
}

/**
 * Какие файлы из выбранных брать: тип, размер и общий лимит вложений. Отказы
 * возвращаются отдельно — по одному тосту на причину, а не по тосту на файл.
 */
export function pickAcceptable(
  files: readonly File[],
  already: number,
  maxBytes: (mime: string) => number,
): { accepted: File[]; rejected: Set<RejectReason> } {
  const accepted: File[] = []
  const rejected = new Set<RejectReason>()
  for (const file of files) {
    if (!isPostMediaFile(file)) rejected.add('type')
    else if (file.size > maxBytes(file.type)) rejected.add('size')
    else if (already + accepted.length >= MAX_POST_MEDIA) rejected.add('limit')
    else accepted.push(file)
  }
  return { accepted, rejected }
}

/** Переставить элемент: вынуть с позиции `from` и вставить на `to`. Края — обрезаются. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return [...list]
  const next = [...list]
  const [item] = next.splice(from, 1)
  const target = Math.max(0, Math.min(to, next.length))
  next.splice(target, 0, item as T)
  return next
}

/** id загруженных файлов в порядке редактора — ровно этот порядок уходит в `mediaIds`. */
export function readyMediaIds(items: readonly ComposerMedia[]): string[] {
  return items.flatMap((m) => (m.status === 'done' && m.fileId ? [m.fileId] : []))
}
