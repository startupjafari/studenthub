import { randomInt } from 'node:crypto'

// Код в печатном QR помещения (Ф16). Алфавит без визуально похожих символов (0/O, 1/I/L),
// потому что код печатается на наклейке текстом — как запасной путь, если QR не читается.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const LENGTH = 8

/** Случайный код помещения: 8 символов из 31 → ~8·10^11 вариантов, коллизии ловит unique-индекс. */
export function randomCode(): string {
  let code = ''
  for (let i = 0; i < LENGTH; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)]
  }
  return code
}

/** Отображение на наклейке: `ABCD-EFGH` читается и набирается вручную заметно легче. */
export function formatCode(code: string): string {
  return code.length === LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}
