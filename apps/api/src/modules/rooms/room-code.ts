import { readableCode } from '../../common/crypto/readable-code'

// Код в печатном QR помещения (Ф16). Алфавит и длина — общие для всех кодов, которые
// человек набирает руками (см. common/crypto/readable-code).
const LENGTH = 8

/** Случайный код помещения. Коллизии ловит unique-индекс. */
export function randomCode(): string {
  return readableCode(LENGTH)
}

/** Отображение на наклейке: `ABCD-EFGH` читается и набирается вручную заметно легче. */
export function formatCode(code: string): string {
  return code.length === LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}
