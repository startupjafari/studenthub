import * as XLSX from 'xlsx'
import { AppException } from '../../common/exceptions/app.exception'

// Разбор загруженного файла массового приглашения в нормализованные строки.
// Поддержка CSV (без внешних зависимостей) и XLSX/XLS (SheetJS). Колонки распознаём
// по заголовку без учёта регистра и языка; порядок колонок произвольный.
export interface RawBulkRow {
  line: number // номер строки в исходном файле (1 = заголовок), для показа ошибок
  email: string
  group: string
  role: string
}

// Синонимы заголовков (ru/en). Ключи — что ищем, значения — допустимые заголовки.
const HEADER_ALIASES: Record<'email' | 'group' | 'role', string[]> = {
  email: ['email', 'e-mail', 'mail', 'почта', 'эл. почта', 'емейл', 'мейл'],
  group: ['group', 'группа', 'группы', 'group name'],
  role: ['role', 'роль'],
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Сопоставляет заголовки файла с нашими полями. email/group обязательны, role — нет.
function resolveColumns(headers: string[]): { email: number; group: number; role: number } {
  const norm = headers.map(normalizeHeader)
  const find = (field: 'email' | 'group' | 'role'): number =>
    norm.findIndex((h) => HEADER_ALIASES[field].includes(h))
  const email = find('email')
  const group = find('group')
  if (email === -1 || group === -1) {
    throw new AppException(
      'BAD_REQUEST',
      'В файле должны быть колонки «email» и «group» (первая строка — заголовки)',
    )
  }
  return { email, group, role: find('role') }
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
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new AppException('BAD_REQUEST', 'В книге нет листов')
  const sheet = wb.Sheets[sheetName]
  if (!sheet) throw new AppException('BAD_REQUEST', 'Первый лист книги пуст')
  // header:1 → массив массивов; defval гарантирует одинаковую длину строк.
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', blankrows: false })
}

// Матрица (первая строка — заголовки) → нормализованные строки email/group/role.
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
