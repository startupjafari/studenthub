// xlsx ставится ТАРБОЛЛОМ с cdn.sheetjs.com, а не из npm, и это не прихоть: в реестре
// последняя опубликованная версия — 0.18.5 с прототипным загрязнением (CVE-2023-30533) и
// ReDoS, а исправления живут только в вендорской раздаче (0.19.3+/0.20.2+). Здесь как раз
// разбирается ЗАГРУЖЕННЫЙ пользователем файл, то есть ровно тот путь, по которому эти
// уязвимости и срабатывают. Следствие: сборке (CI, Docker) нужен доступ к cdn.sheetjs.com.
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

// ── XLSX: первый лист → матрица строк ──
function parseXlsx(buffer: Buffer, { maxRows, maxColumns }: TableLimits): string[][] {
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
    return parseCsv(buffer.toString('utf8'), limits)
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
