import * as XLSX from 'xlsx'
import { buildCsv, buildWorkbook, type SpreadsheetColumn } from './spreadsheet.builder'
import { exportLabels } from './export-labels'
import type { SheetMetadata } from './export-branding.types'

interface Row {
  id: string
  name: string
  blocked: boolean
}

const columns: SpreadsheetColumn<Row>[] = [
  { header: 'ID', value: (r) => r.id },
  { header: 'Имя', value: (r) => r.name },
  { header: 'Заблокирован', value: (r) => r.blocked },
]
const rows: Row[] = [
  { id: 'u-1', name: 'Аружан', blocked: false },
  { id: 'u-2', name: 'Диас "Д" Сериков', blocked: true },
]
const meta = { Title: 'Список — StudentHub', Company: 'StudentHub' } as SheetMetadata

/** `book.Sheets[name]` типизирован как возможно-undefined — в тесте лист заведомо есть. */
function sheetOf(book: XLSX.WorkBook, name: string): XLSX.WorkSheet {
  const sheet = book.Sheets[name]
  if (!sheet) throw new Error(`В книге нет листа «${name}»`)
  return sheet
}

function build(data = rows) {
  return buildWorkbook({
    columns,
    rows: data,
    labels: exportLabels('ru'),
    info: [
      ['Система', 'StudentHub — studenthub.kz'],
      ['Пользователь', 'Асанов Асан'],
    ],
    meta,
  })
}

describe('buildWorkbook', () => {
  it('лист с данными идёт первым — парсер читает именно его', () => {
    const book = XLSX.read(build(), { type: 'buffer' })
    expect(book.SheetNames).toEqual(['Данные', 'Инфо'])
  })

  it('заголовки стоят в первой строке, брендирование их не сдвигает', () => {
    const book = XLSX.read(build(), { type: 'buffer' })
    // Ровно то, что сделает `pandas.read_excel` и любой импорт «первая строка = заголовки».
    const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheetOf(book, 'Данные'))
    expect(parsed).toHaveLength(2)
    const first = parsed[0]
    expect(first).toBeDefined()
    expect(Object.keys(first ?? {})).toEqual(['ID', 'Имя', 'Заблокирован'])
    expect(first?.ID).toBe('u-1')
  })

  it('происхождение выгрузки уехало на отдельный лист', () => {
    const book = XLSX.read(build(), { type: 'buffer' })
    const info = XLSX.utils.sheet_to_json<unknown[]>(sheetOf(book, 'Инфо'), { header: 1 })
    expect(info[0]).toEqual(['Система', 'StudentHub — studenthub.kz'])
  })

  it('автофильтр и именованный диапазон накрывают шапку и строки', () => {
    const book = XLSX.read(build(), { type: 'buffer' })
    const sheet = sheetOf(book, 'Данные') as unknown as { '!autofilter'?: { ref: string } }
    expect(sheet['!autofilter']?.ref).toBe('A1:C3')
    // Абсолютная ссылка: относительная «съезжает» вслед за активной ячейкой.
    expect(book.Workbook?.Names?.[0]?.Ref).toBe("'Данные'!$A$1:$C$3")
  })

  it('свойства книги попадают в файл', () => {
    const book = XLSX.read(build(), { type: 'buffer' })
    expect(book.Props?.Title).toBe('Список — StudentHub')
    expect(book.Props?.Company).toBe('StudentHub')
  })

  it('пустая выгрузка — это книга с одной шапкой, а не ошибка', () => {
    const book = XLSX.read(build([]), { type: 'buffer' })
    expect(XLSX.utils.sheet_to_json(sheetOf(book, 'Данные'))).toHaveLength(0)
    const sheet = sheetOf(book, 'Данные') as unknown as { '!autofilter'?: { ref: string } }
    expect(sheet['!autofilter']?.ref).toBe('A1:C1')
  })
})

describe('buildCsv', () => {
  it('начинается с BOM — без него Excel читает UTF-8 как cp1251', () => {
    expect(buildCsv({ columns, rows }).charCodeAt(0)).toBe(0xfeff)
  })

  it('кавычки внутри значения удваиваются, строки разделены CRLF', () => {
    const lines = buildCsv({ columns, rows }).split('\r\n')
    expect(lines[0]).toContain('"ID","Имя","Заблокирован"')
    expect(lines[2]).toBe('"u-2","Диас ""Д"" Сериков","true"')
  })

  it('строк происхождения в CSV нет: они оказались бы прямо в таблице', () => {
    expect(buildCsv({ columns, rows })).not.toContain('Система')
  })
})
