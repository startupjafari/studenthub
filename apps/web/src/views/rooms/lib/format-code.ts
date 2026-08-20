// Код помещения печатается на наклейке текстом — как запасной путь, если QR не читается.
// Группы по 4 символа заметно легче переписать и набрать (зеркало formatCode на бэкенде).
export function formatRoomCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}
