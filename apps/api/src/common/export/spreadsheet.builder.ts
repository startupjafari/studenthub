import * as XLSX from 'xlsx'
import type { ExportLabels } from './export-labels'
import type { SheetMetadata } from './export-branding.types'

/**
 * Сборка табличных выгрузок — XLSX и CSV (план брендирования, этап A4).
 *
 * Главное решение здесь — КУДА класть брендирование.
 *
 * Требование «видимая маркировка в теле документа» в Excel обычно выполняют шапкой из
 * двух-четырёх строк над таблицей. Это ломает всех, кто читает файл программой: и
 * `pandas.read_excel`, и 1С, и любой импорт «первая строка = заголовки» получат вместо
 * заголовков название системы. Файл, который человек открывает раз, а программа — каждый
 * день, ломать ради подписи нельзя.
 *
 * Поэтому книга из двух листов: первым идёт «Данные» — таблица строго с A1, заголовки в
 * первой строке, ничего лишнего; вторым «Инфо» — система, домен, тип отчёта, дата и
 * таймзона, кто выгрузил, фильтры. Порядок листов важен: `read_excel` без указания листа
 * берёт первый.
 *
 * Закрепление первой строки (freeze panes) в community-сборке SheetJS 0.18.5 при записи
 * не поддерживается — вместо него ставим автофильтр и именованный диапазон: и то и другое
 * помогает и человеку, и парсеру, и не требует новой зависимости.
 */

export interface SpreadsheetColumn<Row> {
  /** Заголовок колонки на языке выгрузки. */
  header: string
  value: (row: Row) => string | number | boolean | null
  /** Ширина в символах. Не задана — берётся по заголовку. */
  width?: number
}

export interface SpreadsheetInput<Row> {
  columns: SpreadsheetColumn<Row>[]
  rows: Row[]
  labels: ExportLabels
  /** Происхождение выгрузки для листа «Инфо» (ExportBrandingService.infoRows). */
  info: Array<[label: string, value: string]>
  /** Свойства книги (ExportBrandingService.sheetMetadata). */
  meta: SheetMetadata
}

/** Книга XLSX: лист данных + лист происхождения. */
export function buildWorkbook<Row>(input: SpreadsheetInput<Row>): Buffer {
  const { columns, rows, labels, info, meta } = input

  const matrix = [
    columns.map((c) => c.header),
    ...rows.map((row) => columns.map((c) => c.value(row))),
  ]
  const data = XLSX.utils.aoa_to_sheet(matrix)
  data['!cols'] = columns.map((c) => ({ wch: c.width ?? Math.max(12, c.header.length + 2) }))

  const lastColumn = XLSX.utils.encode_col(columns.length - 1)
  const lastRow = rows.length + 1
  // Автофильтр по шапке: в Excel он же визуально отделяет заголовки от данных.
  data['!autofilter'] = { ref: `A1:${lastColumn}${lastRow}` }

  const about = XLSX.utils.aoa_to_sheet(info.map(([label, value]) => [label, value]))
  about['!cols'] = [{ wch: 22 }, { wch: 60 }]

  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, data, labels.dataSheet)
  XLSX.utils.book_append_sheet(book, about, labels.infoSheet)
  book.Props = { ...meta }
  // Именованный диапазон: импорт может ссылаться на него вместо «первого листа целиком»
  // и не сломается, если в книге когда-нибудь появится третий лист.
  book.Workbook = {
    ...book.Workbook,
    Names: [
      {
        Name: 'StudentHub_Data',
        // Абсолютная ссылка: относительная у именованного диапазона «съезжает» вслед за
        // активной ячейкой, и формула, сославшаяся на имя, покажет не тот кусок таблицы.
        Ref: `'${labels.dataSheet}'!$A$1:$${lastColumn}$${lastRow}`,
      },
    ],
  }

  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/**
 * CSV: только данные, без строк происхождения.
 *
 * В CSV нет листов, и любая подпись сверху оказалась бы прямо в таблице — то есть сломала
 * бы файл ради маркировки. Происхождение у CSV несут имя файла и журнал экспортов.
 *
 * BOM обязателен: без него Excel открывает UTF-8 как cp1251 и кириллица превращается в
 * «ÐŸÑ€Ð¸Ð²ÐµÑ‚».
 */
export function buildCsv<Row>(input: Pick<SpreadsheetInput<Row>, 'columns' | 'rows'>): string {
  const escape = (value: string | number | boolean | null): string =>
    `"${String(value ?? '').replace(/"/g, '""')}"`
  const lines = [
    input.columns.map((c) => escape(c.header)).join(','),
    ...input.rows.map((row) => input.columns.map((c) => escape(c.value(row))).join(',')),
  ]
  // BOM задаём escape-последовательностью: «невидимка» в исходнике не читается глазами
  // и ломает линтер (no-irregular-whitespace).
  return `\uFEFF${lines.join('\r\n')}`
}
