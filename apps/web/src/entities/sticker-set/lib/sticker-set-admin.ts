import { STICKER_LIMITS } from '@studenthub/shared-schemas'
import type { AdminStickerSet } from '../api/sticker-set-api'

/** Что не так с файлом стикера до загрузки: тип не PNG/WebP/GIF или больше 512 КБ. */
export type StickerFileProblem = 'type' | 'size'

/**
 * Пред-проверка картинки стикера (FRONTEND_RULES §7: размер и тип — до отправки). Серверную
 * проверку по содержимому это не отменяет: браузер судит о типе по расширению.
 */
export function stickerFileProblem(file: Pick<File, 'type' | 'size'>): StickerFileProblem | null {
  if (!(STICKER_LIMITS.MIMES as readonly string[]).includes(file.type)) return 'type'
  if (file.size > STICKER_LIMITS.MAX_BYTES) return 'size'
  return null
}

/** Значение `accept` для выбора файла стикера. */
export const STICKER_ACCEPT = STICKER_LIMITS.MIMES.join(',')

/**
 * Перенос набора на новое место: какие `order` надо записать. Порядок после переноса —
 * индексы 0…n−1; патчим только наборы, у которых `order` от этого изменился (обычно два
 * соседа). Одинаковые `order` (наборы, заведённые до нумерации) так тоже разводятся.
 */
export function reorderPatches(
  sets: Pick<AdminStickerSet, 'id' | 'order'>[],
  from: number,
  to: number,
): { id: string; order: number }[] {
  if (from === to || from < 0 || to < 0 || from >= sets.length || to >= sets.length) return []
  const next = [...sets]
  const [moved] = next.splice(from, 1)
  if (!moved) return []
  next.splice(to, 0, moved)
  return next.flatMap((set, order) => (set.order === order ? [] : [{ id: set.id, order }]))
}
