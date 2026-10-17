// xlsx ставится ТАРБОЛЛОМ с cdn.sheetjs.com, а не из npm, и это не прихоть: в реестре
// последняя опубликованная версия — 0.18.5 с прототипным загрязнением (CVE-2023-30533) и
// ReDoS, а исправления живут только в вендорской раздаче (0.19.3+/0.20.2+). Здесь как раз
// разбирается ЗАГРУЖЕННЫЙ пользователем файл, то есть ровно тот путь, по которому эти
// уязвимости и срабатывают. Следствие: сборке (CI, Docker) нужен доступ к cdn.sheetjs.com.
import * as XLSX from 'xlsx'
import { BULK_INVITE_MAX_ROWS } from '@studenthub/shared-schemas'
import { AppException } from '../../common/exceptions/app.exception'

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

// ── CSV: минимальный корректный парсер (кавычки, экранирование "", ,/; разделитель) ──
function detectDelimiter(firstLine: string): string {
  const commas = (firstLine.match(/,/g) ?? []).length
  const semicolons = (firstLine.match(/;/g) ?? []).length
  return semicolons > commas ? ';' : ','
}

function parseCsv(text: string): string[][] {
  const stripped = text.replace(/^\uFEFF/, '') // BOM
  const firstLineEnd = stripped.indexOf('\n')
  const delimiter = detectDelimiter(
    firstLineEnd === -1 ? stripped : stripped.slice(0, firstLineEnd),
  )
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i]
    if (inQuotes) {
      if (c === '"') {
        if (stripped[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      if (rows.length >= MAX_PARSED_ROWS) return rows
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

// ── XLSX: первый лист → матрица строк ──
function parseXlsx(buffer: Buffer): string[][] {
  // sheetRows — строки дальше потолка парсер пропускает, не создавая ячеек; dense — лист
  // массивом строк, а не объектом с ключом на каждую ячейку.
  const wb = XLSX.read(buffer, { type: 'buffer', sheetRows: MAX_PARSED_ROWS, dense: true })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new AppException('BAD_REQUEST', 'В книге нет листов')
  const sheet = wb.Sheets[sheetName]
  if (!sheet?.['!ref']) throw new AppException('BAD_REQUEST', 'Первый лист книги пуст')
  const range = XLSX.utils.decode_range(sheet['!ref'])
  range.e.c = Math.min(range.e.c, range.s.c + MAX_PARSED_COLUMNS - 1)
  // header:1 → массив массивов; defval гарантирует одинаковую длину строк.
  return XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
    range,
  })
}

// Матрица (первая строка — заголовки) → нормализованные строки email/group/role/faculty.
function toRows(matrix: string[][]): RawBulkRow[] {
  const nonEmpty = matrix.filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
  const headerRow = nonEmpty[0]
  if (!headerRow) {
    throw new AppException('BAD_REQUEST', 'Файл пуст')
  }
  const headers = headerRow.map((c) => String(c ?? ''))
  const cols = resolveColumns(headers)
  const cell = (r: string[], idx: number): string => (idx === -1 ? '' : String(r[idx] ?? '').trim())
  return nonEmpty.slice(1).map((r, i) => ({
    line: i + 2, // +1 за заголовок, +1 за 1-based
    email: cell(r, cols.email),
    group: cell(r, cols.group),
    role: cell(r, cols.role),
    faculty: cell(r, cols.faculty),
  }))
}

// Точка входа: буфер + имя файла → строки. Формат по расширению, XLS(X) как бинарь.
export function parseBulkInviteFile(buffer: Buffer, filename: string): RawBulkRow[] {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (ext === 'csv' || ext === 'txt') {
    return toRows(parseCsv(buffer.toString('utf8')))
  }
  if (ext === 'xlsx' || ext === 'xls') {
    return toRows(parseXlsx(buffer))
  }
  throw new AppException('BAD_REQUEST', 'Поддерживаются только файлы .csv, .xlsx, .xls')
}
