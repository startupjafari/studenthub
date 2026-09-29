import { FILE_UPLOAD, type FileCategory } from '@studenthub/shared-config'

/**
 * Клиентские лимиты размера вложений (docs/FRONTEND_RULES.md §7.6).
 *
 * Серверную проверку по magic bytes это не отменяет — она остаётся единственной настоящей.
 * Смысл здесь во времени ответа: без пред-проверки стомегабайтный файл сначала целиком
 * уезжал на сервер и только там получал отказ по лимиту категории, то есть человек ждал
 * полминуты ради ошибки.
 */

const MIME_TO_CATEGORY = new Map<string, FileCategory>()
for (const category of Object.keys(FILE_UPLOAD.ALLOWED_MIME) as FileCategory[]) {
  for (const mime of FILE_UPLOAD.ALLOWED_MIME[category]) {
    MIME_TO_CATEGORY.set(mime, category)
  }
}

const LARGEST_MAX_BYTES = Math.max(...Object.values(FILE_UPLOAD.MAX_BYTES))

/** Категория по MIME из браузера; undefined — тип не из белого списка. */
export function fileCategoryOfMime(mime: string): FileCategory | undefined {
  return MIME_TO_CATEGORY.get(mime)
}

/**
 * Предельный размер для файла по его MIME.
 *
 * Незнакомый тип не отбиваем здесь по размеру категории: браузер для некоторых файлов
 * отдаёт пустой `type`, и отказ на догадке отрезал бы годное вложение. Такому файлу даём
 * самый мягкий лимит, а тип определит сервер по содержимому.
 */
export function maxUploadBytes(mime: string): number {
  const category = fileCategoryOfMime(mime)
  return category ? FILE_UPLOAD.MAX_BYTES[category] : LARGEST_MAX_BYTES
}

/**
 * Превышает ли файл свой лимит.
 *
 * Снимки проверяются по самому мягкому лимиту, а не по лимиту IMAGE: перед отправкой
 * сжатие уменьшает их в разы, и отказ в момент выбора отрезал бы фотографию, которая
 * дошла бы без проблем. Окончательный размер снимка проверяется уже после сжатия.
 */
export function isOversizeOnPick(file: File): boolean {
  const limit = file.type.startsWith('image/') ? LARGEST_MAX_BYTES : maxUploadBytes(file.type)
  return file.size > limit
}
