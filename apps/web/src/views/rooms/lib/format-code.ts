// Код помещения печатается на наклейке текстом — как запасной путь, если QR не читается.
// Группы по 4 символа заметно легче переписать и набрать (зеркало formatCode на бэкенде).

// Тот же алфавит, что у генератора кодов на бэкенде (apps/api/.../room-code.ts): без 0/O,
// 1/I/L и прочих пар, которые путаются при переписывании с наклейки.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const LENGTH = 8

export function formatRoomCode(code: string): string {
  return code.length === LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}

/**
 * Приводит набранное вручную к виду кода: верхний регистр, только символы алфавита, не длиннее
 * восьми. Дефисы, пробелы и «похожие» буквы (O, I, L) отбрасываются — в коде их не бывает
 * в принципе, поэтому это опечатка ввода, а не значащий символ.
 */
export function normalizeRoomCode(input: string): string {
  const upper = input.toUpperCase()
  let out = ''
  for (const ch of upper) {
    if (ALPHABET.includes(ch)) out += ch
    if (out.length === LENGTH) break
  }
  return out
}

/** Код набран полностью — можно открывать страницу помещения. */
export function isCompleteRoomCode(code: string): boolean {
  return code.length === LENGTH
}
