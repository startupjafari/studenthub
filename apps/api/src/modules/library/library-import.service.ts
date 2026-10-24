import { Injectable } from '@nestjs/common'
import {
  IsbnSchema,
  LIBRARY_COPIES_MAX,
  LIBRARY_IMPORT_MAX_ROWS,
  type LibraryImportCommitInput,
  type LibraryImportPreviewResponse,
  type LibraryImportPreviewRow,
  type LibraryImportResult,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { nonEmptyRows, readTableFile } from '../../common/import/table-file'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { LibraryCatalogService, type CopyBatch } from './library-catalog.service'
import { staffLibrary } from './library-scope'

// Импорт фонда из CSV/XLSX (Фаза 20.3): одна строка — книга и её экземпляры. Как импорт
// инвайтов: сначала предпросмотр без записи (ошибки по строкам), затем запись только готовых
// строк. Книга, которая уже есть в каталоге (тот же ISBN или то же название с авторами),
// не дублируется — к ней добавляются экземпляры.

type Column =
  'title' | 'authors' | 'isbn' | 'publisher' | 'year' | 'section' | 'inventory' | 'count'

// Синонимы заголовков (ru/kk/en), без учёта регистра.
const HEADER_ALIASES: Record<Column, string[]> = {
  title: ['название', 'наименование', 'книга', 'заглавие', 'title', 'атауы'],
  authors: ['автор', 'авторы', 'author', 'authors', 'авторлар'],
  isbn: ['isbn'],
  publisher: ['издательство', 'publisher', 'баспа'],
  year: ['год', 'год издания', 'year', 'жыл'],
  section: ['раздел', 'рубрика', 'section', 'category', 'бөлім'],
  inventory: [
    'инвентарный номер',
    'инвентарные номера',
    'инв. номер',
    'инв номер',
    'инв.',
    'инв',
    'inventory',
    'inventory number',
    'inventory numbers',
  ],
  count: ['количество', 'кол-во', 'экземпляров', 'экземпляры', 'count', 'copies', 'саны'],
}

const MAX_PARSED_ROWS = LIBRARY_IMPORT_MAX_ROWS * 2 + 1
const MAX_PARSED_COLUMNS = 50

export interface RawLibraryRow {
  line: number
  title: string
  authors: string
  isbn: string
  publisher: string
  year: string
  section: string
  inventory: string
  count: string
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Буфер файла → строки с номером строки в файле (1 — заголовок). */
export function parseLibraryImportFile(buffer: Buffer, filename: string): RawLibraryRow[] {
  const matrix = readTableFile(buffer, filename, {
    maxRows: MAX_PARSED_ROWS,
    maxColumns: MAX_PARSED_COLUMNS,
  })
  const nonEmpty = nonEmptyRows(matrix)
  const headerRow = nonEmpty[0]
  if (!headerRow) throw new AppException('BAD_REQUEST', 'Файл пуст')
  const headers = headerRow.cells.map((c) => normalizeHeader(String(c ?? '')))
  const col = (field: Column): number => headers.findIndex((h) => HEADER_ALIASES[field].includes(h))
  const columns = Object.fromEntries(
    (Object.keys(HEADER_ALIASES) as Column[]).map((f) => [f, col(f)]),
  ) as Record<Column, number>
  if (columns.title === -1) {
    throw new AppException(
      'BAD_REQUEST',
      'В файле должна быть колонка «Название» (первая строка — заголовки)',
    )
  }
  const cell = (r: string[], idx: number): string => (idx === -1 ? '' : String(r[idx] ?? '').trim())
  return nonEmpty.slice(1).map(({ line, cells: r }) => ({
    // Номер строки в файле, а не по счёту непустых: его ищут глазами в Excel.
    line,
    title: cell(r, columns.title),
    authors: cell(r, columns.authors),
    isbn: cell(r, columns.isbn),
    publisher: cell(r, columns.publisher),
    year: cell(r, columns.year),
    section: cell(r, columns.section),
    inventory: cell(r, columns.inventory),
    count: cell(r, columns.count),
  }))
}

function bookKey(title: string, authors: string): string {
  return `${title.trim().toLowerCase()}\u0000${authors.trim().toLowerCase()}`
}

@Injectable()
export class LibraryImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly catalog: LibraryCatalogService,
  ) {}

  /** Проверка строк без записи: что готово, что повторяет фонд, что с ошибкой. */
  async preview(actor: JwtPayload, raw: RawLibraryRow[]): Promise<LibraryImportPreviewResponse> {
    const universityId = staffLibrary(actor)
    if (raw.length > LIBRARY_IMPORT_MAX_ROWS) {
      throw new AppException(
        'BAD_REQUEST',
        `В файле больше ${LIBRARY_IMPORT_MAX_ROWS} строк — разбейте его на части`,
      )
    }
    const allNumbers = raw.flatMap((r) => splitInventory(r.inventory))
    const taken = new Set(
      allNumbers.length === 0
        ? []
        : (
            await this.prisma.bookCopy.findMany({
              where: { universityId, inventoryNumber: { in: allNumbers } },
              select: { inventoryNumber: true },
              take: allNumbers.length,
            })
          ).map((c) => c.inventoryNumber),
    )
    const seen = new Set<string>()
    const rows: LibraryImportPreviewRow[] = raw.map((r) => {
      const inventoryNumbers = splitInventory(r.inventory)
      const base: LibraryImportPreviewRow = {
        line: r.line,
        title: r.title,
        authors: r.authors,
        isbn: null,
        publisher: r.publisher || null,
        year: null,
        section: r.section || null,
        inventoryNumbers,
        count: 0,
        status: 'READY',
        error: null,
      }
      const fail = (error: string): LibraryImportPreviewRow => ({ ...base, status: 'ERROR', error })
      if (!r.title) return fail('Нет названия')
      if (r.title.length > 300) return fail('Название длиннее 300 символов')
      if (r.authors.length > 300) return fail('Авторы длиннее 300 символов')
      if (r.isbn) {
        const isbn = IsbnSchema.safeParse(r.isbn)
        if (!isbn.success) return fail('ISBN — 10 или 13 цифр')
        base.isbn = isbn.data
      }
      if (r.year) {
        const year = Number(r.year)
        if (!Number.isInteger(year) || year < 1450 || year > new Date().getFullYear() + 1) {
          return fail('Год издания — четыре цифры')
        }
        base.year = year
      }
      if (inventoryNumbers.some((n) => n.length > 40)) {
        return fail('Инвентарный номер длиннее 40 символов')
      }
      if (r.count) {
        const count = Number(r.count)
        if (!Number.isInteger(count) || count < 0 || count > LIBRARY_COPIES_MAX) {
          return fail(`Количество — целое число до ${LIBRARY_COPIES_MAX}`)
        }
        base.count = count
      }
      // Ни номеров, ни количества — один экземпляр с номером по порядку.
      if (inventoryNumbers.length === 0 && !r.count) base.count = 1
      if (inventoryNumbers.length + base.count > LIBRARY_COPIES_MAX) {
        return fail(`Больше ${LIBRARY_COPIES_MAX} экземпляров в одной строке`)
      }
      const clash = inventoryNumbers.filter((n) => taken.has(n) || seen.has(n))
      inventoryNumbers.forEach((n) => seen.add(n))
      if (clash.length > 0) {
        return { ...base, status: 'DUPLICATE', error: `Номер уже есть: ${clash.join(', ')}` }
      }
      return base
    })
    const ready = rows.filter((r) => r.status === 'READY')
    return {
      rows,
      summary: {
        total: rows.length,
        ready: ready.length,
        duplicate: rows.filter((r) => r.status === 'DUPLICATE').length,
        error: rows.filter((r) => r.status === 'ERROR').length,
        copies: ready.reduce((sum, r) => sum + r.inventoryNumbers.length + r.count, 0),
      },
    }
  }

  /**
   * Запись готовых строк. Книги ищутся в каталоге по ISBN, затем по названию с авторами;
   * найденная получает новые экземпляры, остальные заводятся. Номера проверяются заново —
   * между предпросмотром и записью фонд могли пополнить.
   */
  async commit(
    actor: JwtPayload,
    input: LibraryImportCommitInput,
    ctx: RequestContext,
  ): Promise<LibraryImportResult> {
    const universityId = staffLibrary(actor)
    let books = 0
    let matched = 0
    const copies = await this.catalog.createCopies(universityId, async (tx) => {
      books = 0
      matched = 0
      const existing = await tx.book.findMany({
        where: { universityId, archivedAt: null },
        select: { id: true, title: true, authors: true, isbn: true },
        take: 20000,
      })
      const byIsbn = new Map(existing.filter((b) => b.isbn).map((b) => [b.isbn as string, b.id]))
      const byKey = new Map(existing.map((b) => [bookKey(b.title, b.authors), b.id]))
      const batches: CopyBatch[] = []
      for (const row of input.rows) {
        let bookId =
          (row.isbn ? byIsbn.get(row.isbn) : undefined) ??
          byKey.get(bookKey(row.title, row.authors))
        if (bookId) {
          matched += 1
        } else {
          const book = await tx.book.create({
            data: {
              universityId,
              title: row.title,
              authors: row.authors,
              isbn: row.isbn ?? null,
              publisher: row.publisher ?? null,
              year: row.year ?? null,
              section: row.section ?? null,
              createdById: actor.sub,
            },
            select: { id: true },
          })
          bookId = book.id
          books += 1
          if (row.isbn) byIsbn.set(row.isbn, bookId)
          byKey.set(bookKey(row.title, row.authors), bookId)
        }
        // Ни номеров, ни количества — один экземпляр с номером по порядку.
        const count = row.inventoryNumbers.length === 0 && row.count === 0 ? 1 : row.count
        batches.push({ bookId, inventoryNumbers: row.inventoryNumbers, count })
      }
      return batches
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'library_import',
      entity: 'University',
      entityId: universityId,
      metadata: { rows: input.rows.length, books, matched, copies: copies.length },
      ...ctx,
    })
    return { books, matched, copies: copies.length, skipped: 0 }
  }
}

/** Инвентарные номера ячейки: через запятую, точку с запятой или перевод строки. */
function splitInventory(value: string): string[] {
  return value
    .split(/[,;\n]+/)
    .map((v) => v.trim())
    .filter(Boolean)
}
