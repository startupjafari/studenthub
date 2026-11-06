import { BULK_INVITE_MAX_ROWS } from '@studenthub/shared-schemas'
import { AppException } from '../../common/exceptions/app.exception'
import { nonEmptyRows, readTableFile } from '../../common/import/table-file'

// Разбор загруженного файла массового приглашения в нормализованные строки.
// Поддержка CSV (без внешних зависимостей) и XLSX/XLS (SheetJS). Колонки распознаём
// по заголовку без учёта регистра и языка; порядок колонок произвольный.
export interface RawBulkRow {
  line: number // номер строки в исходном файле (1 = заголовок), для показа ошибок
  email: string
  group: string
  role: string
  // Факультет — для деканов (обязателен) и преподавателей (по желанию).
  faculty: string
}

type BulkColumn = 'email' | 'group' | 'role' | 'faculty'

// Потолок разбора: заголовок и вдвое больше строк, чем принимает импорт. Файл до 10 МБ
// (сжатый XLSX тем более) разворачивался целиком — миллион строк синхронно, в event loop, —
// хотя лимит в 500 строк проверялся уже после. Запас вдвое — на пустые строки внутри списка:
// всё, что больше 500 непустых, импорт отклонит и так (InviteService.bulkPreview), а дальше
// этой строки файл не читается вовсе.
const MAX_PARSED_ROWS = BULK_INVITE_MAX_ROWS * 2 + 1
// Нужны четыре колонки, читаем не дальше пятидесятой: одна ячейка в столбце XFD иначе
// разворачивала каждую строку листа в 16 тысяч значений.
const MAX_PARSED_COLUMNS = 50

// Синонимы заголовков (ru/en). Ключи — что ищем, значения — допустимые заголовки.
const HEADER_ALIASES: Record<BulkColumn, string[]> = {
  email: ['email', 'e-mail', 'mail', 'почта', 'эл. почта', 'емейл', 'мейл'],
  group: ['group', 'группа', 'группы', 'group name'],
  role: ['role', 'роль'],
  faculty: ['faculty', 'факультет', 'faculty name'],
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Сопоставляет заголовки файла с нашими полями. Обязателен только email: группа нужна
// студентам и старостам, факультет — деканам, и какая колонка обязательна, решает роль
// строки (InviteService.bulkPreview), а не заголовок. Список одних преподавателей группы
// не содержит вовсе.
function resolveColumns(headers: string[]): Record<BulkColumn, number> {
  const norm = headers.map(normalizeHeader)
  const find = (field: BulkColumn): number =>
    norm.findIndex((h) => HEADER_ALIASES[field].includes(h))
  const email = find('email')
  if (email === -1) {
    throw new AppException(
      'BAD_REQUEST',
      'В файле должна быть колонка «email» (первая строка — заголовки)',
    )
  }
  return { email, group: find('group'), role: find('role'), faculty: find('faculty') }
}

// Матрица (первая строка — заголовки) → нормализованные строки email/group/role/faculty.
function toRows(matrix: string[][]): RawBulkRow[] {
  const nonEmpty = nonEmptyRows(matrix)
  const headerRow = nonEmpty[0]
  if (!headerRow) {
    throw new AppException('BAD_REQUEST', 'Файл пуст')
  }
  const headers = headerRow.cells.map((c) => String(c ?? ''))
  const cols = resolveColumns(headers)
  const cell = (r: string[], idx: number): string => (idx === -1 ? '' : String(r[idx] ?? '').trim())
  return nonEmpty.slice(1).map(({ line, cells: r }) => ({
    // Номер строки в файле, а не по счёту непустых: его ищут глазами в Excel.
    line,
    email: cell(r, cols.email),
    group: cell(r, cols.group),
    role: cell(r, cols.role),
    faculty: cell(r, cols.faculty),
  }))
}

// Точка входа: буфер + имя файла → строки (чтение таблицы — common/import/table-file).
export function parseBulkInviteFile(buffer: Buffer, filename: string): RawBulkRow[] {
  return toRows(
    readTableFile(buffer, filename, { maxRows: MAX_PARSED_ROWS, maxColumns: MAX_PARSED_COLUMNS }),
  )
}
