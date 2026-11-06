// xlsx ставится ТАРБОЛЛОМ с cdn.sheetjs.com, а не из npm, и это не прихоть: в реестре
// последняя опубликованная версия — 0.18.5 с прототипным загрязнением (CVE-2023-30533) и
// ReDoS, а исправления живут только в вендорской раздаче (0.19.3+/0.20.2+). Здесь как раз
// разбирается ЗАГРУЖЕННЫЙ пользователем файл, то есть ровно тот путь, по которому эти
// уязвимости и срабатывают. Следствие: сборке (CI, Docker) нужен доступ к cdn.sheetjs.com.
import { inflateRawSync } from 'node:zlib'
import * as XLSX from 'xlsx'
import { AppException } from '../exceptions/app.exception'

// Чтение загруженной таблицы (CSV или первый лист XLSX/XLS) в матрицу строк: первая строка —
// заголовки. Общее для импорта списков (инвайты, фонд библиотеки); что значат колонки, решает
// сам импорт. Потолки строк и колонок — чтобы файл до 10 МБ не разворачивался целиком
// синхронно в event loop: дальше потолка файл не читается вовсе.
//
// Матрица выровнена по строкам файла: `matrix[i]` — строка `i + 1`, пустые строки остаются на
// месте. Номер строки в ошибке импорта человек ищет в Excel, и он не должен съезжать на число
// пустых строк выше (nonEmptyRows).

export interface TableLimits {
  maxRows: number
  maxColumns: number
}

// ── CSV: минимальный корректный парсер (кавычки, экранирование "", ,/; разделитель) ──
function detectDelimiter(firstLine: string): string {
  const commas = (firstLine.match(/,/g) ?? []).length
  const semicolons = (firstLine.match(/;/g) ?? []).length
  return semicolons > commas ? ';' : ','
}

function parseCsv(text: string, { maxRows, maxColumns }: TableLimits): string[][] {
  const stripped = text.replace(/^\uFEFF/, '') // BOM
  const firstLineEnd = stripped.indexOf('\n')
  const delimiter = detectDelimiter(
    firstLineEnd === -1 ? stripped : stripped.slice(0, firstLineEnd),
  )
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  // Колонки дальше потолка не копятся: строка в сто тысяч разделителей иначе развернулась
  // бы в массив той же длины — потолок колонок действовал только для XLSX.
  const pushField = () => {
    if (row.length < maxColumns) row.push(field)
    field = ''
  }
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
      pushField()
    } else if (c === '\n') {
      pushField()
      rows.push(row)
      row = []
      if (rows.length >= maxRows) return rows
    } else if (c !== '\r' && row.length < maxColumns) {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    pushField()
    rows.push(row)
  }
  return rows
}

// ── XLSX: проверка архива до разбора ──
//
// XLSX — zip. `sheetRows` ограничивает только ячейки, а `XLSX.read` синхронно распаковывает
// в память ВСЕ записи архива: zip-бомба до 10 МБ разворачивалась в гигабайты и роняла API
// целиком (BACKEND_RULES §14). Поэтому до разбора каждая запись распаковывается здесь с
// потолком на выход (`maxOutputLength`): верим не объявленным в архиве размерам, а тому,
// что получилось на деле. Настоящая таблица импорта в пределах потолков строк весит единицы
// мегабайт; 50 МБ — с большим запасом.
const MAX_UNPACKED_BYTES = 50 * 1024 * 1024
const MAX_ZIP_ENTRIES = 1000
const ZIP_LOCAL_HEADER = 0x04034b50
const ZIP_CENTRAL_HEADER = 0x02014b50
const ZIP_END_OF_CENTRAL_DIR = 0x06054b50
const ZIP_STORED = 0
const ZIP_DEFLATED = 8

function brokenWorkbook(): AppException {
  return new AppException('BAD_REQUEST', 'Файл XLSX повреждён')
}

function oversizedWorkbook(): AppException {
  return new AppException(
    'BAD_REQUEST',
    'Книга распаковывается в слишком большой объём — оставьте в файле только нужный лист',
  )
}

/** Конец центрального каталога: последние 22 байта плюс комментарий архива до 64 КБ. */
function findEndOfCentralDir(buffer: Buffer): number {
  const last = buffer.length - 22
  for (let i = last; i >= 0 && i >= last - 0xffff; i--) {
    if (buffer.readUInt32LE(i) === ZIP_END_OF_CENTRAL_DIR) return i
  }
  return -1
}

/** Сумма распакованных размеров записей архива не больше MAX_UNPACKED_BYTES. */
function assertZipWithinBudget(buffer: Buffer): void {
  const eocd = findEndOfCentralDir(buffer)
  if (eocd < 0) throw brokenWorkbook()
  const entries = buffer.readUInt16LE(eocd + 10)
  const centralDirOffset = buffer.readUInt32LE(eocd + 16)
  // 0xFFFF / 0xFFFFFFFF — признаки ZIP64: таблице на 10 МБ он не нужен никогда.
  if (entries === 0xffff || centralDirOffset === 0xffffffff) throw oversizedWorkbook()
  if (entries > MAX_ZIP_ENTRIES) throw oversizedWorkbook()

  let budget = MAX_UNPACKED_BYTES
  let pos = centralDirOffset
  for (let n = 0; n < entries; n++) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== ZIP_CENTRAL_HEADER) {
      throw brokenWorkbook()
    }
    const method = buffer.readUInt16LE(pos + 10)
    const compressedSize = buffer.readUInt32LE(pos + 20)
    const localOffset = buffer.readUInt32LE(pos + 42)
    pos +=
      46 +
      buffer.readUInt16LE(pos + 28) +
      buffer.readUInt16LE(pos + 30) +
      buffer.readUInt16LE(pos + 32)

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== ZIP_LOCAL_HEADER) {
      throw brokenWorkbook()
    }
    const dataStart =
      localOffset +
      30 +
      buffer.readUInt16LE(localOffset + 26) +
      buffer.readUInt16LE(localOffset + 28)
    if (dataStart + compressedSize > buffer.length) throw brokenWorkbook()

    let unpacked: number
    if (method === ZIP_STORED) {
      unpacked = compressedSize
    } else if (method === ZIP_DEFLATED) {
      try {
        unpacked = inflateRawSync(buffer.subarray(dataStart, dataStart + compressedSize), {
          maxOutputLength: Math.max(budget, 1),
        }).length
      } catch (error) {
        if ((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw oversizedWorkbook()
        throw brokenWorkbook()
      }
    } else {
      throw brokenWorkbook()
    }
    budget -= unpacked
    if (budget < 0) throw oversizedWorkbook()
  }
}

/**
 * Текст CSV. Excel под Windows сохраняет «CSV (разделители — запятые)» в cp1251, а не в
 * UTF-8: такой файл, прочитанный как UTF-8, превращал заголовки в «����», и импорт
 * отказывал с неверной причиной «нет колонки „Название“». Не UTF-8 — читаем как cp1251.
 */
function decodeCsv(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('windows-1251').decode(buffer)
  }
}

// ── XLSX: первый лист → матрица строк ──
function parseXlsx(buffer: Buffer, { maxRows, maxColumns }: TableLimits): string[][] {
  // XLS (старый двоичный формат) — не zip и не сжат: бомбе там взяться неоткуда.
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === ZIP_LOCAL_HEADER) {
    assertZipWithinBudget(buffer)
  }
  // sheetRows — строки дальше потолка парсер пропускает, не создавая ячеек; dense — лист
  // массивом строк, а не объектом с ключом на каждую ячейку.
  const wb = XLSX.read(buffer, { type: 'buffer', sheetRows: maxRows, dense: true })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new AppException('BAD_REQUEST', 'В книге нет листов')
  const sheet = wb.Sheets[sheetName]
  if (!sheet?.['!ref']) throw new AppException('BAD_REQUEST', 'Первый лист книги пуст')
  const range = XLSX.utils.decode_range(sheet['!ref'])
  range.e.c = Math.min(range.e.c, range.s.c + maxColumns - 1)
  // С первой строки листа и с пустыми строками: индекс в матрице — номер строки в Excel,
  // даже если таблица начинается ниже или в ней есть пропуски.
  range.s.r = 0
  // header:1 → массив массивов; defval гарантирует одинаковую длину строк.
  return XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: true,
    range,
  })
}

/** Буфер + имя файла → матрица строк. Формат — по расширению, XLS(X) как бинарь. */
export function readTableFile(buffer: Buffer, filename: string, limits: TableLimits): string[][] {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (ext === 'csv' || ext === 'txt') {
    return parseCsv(decodeCsv(buffer), limits)
  }
  if (ext === 'xlsx' || ext === 'xls') {
    return parseXlsx(buffer, limits)
  }
  throw new AppException('BAD_REQUEST', 'Поддерживаются только файлы .csv, .xlsx, .xls')
}

/**
 * Непустые строки матрицы с номером строки в файле (1-based). Первая из них — заголовки.
 * Номер берётся из положения в файле, а не из счёта непустых: пустая строка выше иначе
 * сдвигала номера во всех ошибках импорта.
 */
export function nonEmptyRows(matrix: string[][]): Array<{ line: number; cells: string[] }> {
  const rows: Array<{ line: number; cells: string[] }> = []
  matrix.forEach((cells, i) => {
    if (cells.some((c) => String(c ?? '').trim() !== '')) rows.push({ line: i + 1, cells })
  })
  return rows
}
