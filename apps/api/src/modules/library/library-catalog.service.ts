import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import type {
  AddBookCopiesInput,
  BookAvailability,
  BookCard,
  BookCopyByCode,
  BookCopyItem,
  BookCopyLabel,
  BookDetail,
  BookListQueryInput,
  CreateBookInput,
  UpdateBookCopyInput,
  UpdateBookInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import { readableCode } from '../../common/crypto/readable-code'
import { advisoryXactLock } from '../../common/prisma/advisory-lock'
import { renderQrDataUrl } from '../../common/qr/qr-image'
import { webBaseUrl } from '../../config/web-base'
import type { EnvVars } from '../../config/env.schema'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { FileService } from '../files/file.service'
import { LibrarySettingsService } from './library-settings.service'
import { LibraryReservationsService } from './library-reservations.service'
import { lockBookQueue } from './library-holds'
import { LIBRARY_STAFF_ROLES, libraryConflict, memberLibrary, staffLibrary } from './library-scope'

// Каталог и экземпляры (Фаза 20.3, docs/PROJECT.md §3.11). Фонд ведут библиотекарь и админ
// вуза; читатели (студенты и старосты) видят каталог включённой библиотеки — книги не из
// архива и сколько экземпляров на полке. Кому выдан экземпляр, видят только те, кто ведёт фонд.

/** Код QR-наклейки экземпляра — как у помещений (BACKEND_RULES §13.2): 8 символов. */
const COPY_CODE_LENGTH = 8
const CODE_ATTEMPTS = 5
const QR_PRINT_WIDTH = 600

export const BOOK_SELECT = {
  id: true,
  universityId: true,
  title: true,
  authors: true,
  isbn: true,
  publisher: true,
  year: true,
  section: true,
  description: true,
  coverFileId: true,
  archivedAt: true,
} satisfies Prisma.BookSelect

type BookRow = Prisma.BookGetPayload<{ select: typeof BOOK_SELECT }>

export const COPY_SELECT = {
  id: true,
  bookId: true,
  universityId: true,
  inventoryNumber: true,
  code: true,
  status: true,
  condition: true,
  note: true,
  inventoriedAt: true,
  loans: {
    where: { status: 'OPEN' },
    select: { id: true, readerName: true, readerGroup: true, dueAt: true },
    take: 1,
  },
} satisfies Prisma.BookCopySelect

type CopyRow = Prisma.BookCopyGetPayload<{ select: typeof COPY_SELECT }>

/** Экземпляры одной книги: явные номера и сколько ещё завести с номерами по порядку. */
export interface CopyBatch {
  bookId: string
  inventoryNumbers: string[]
  count: number
}

const EMPTY_AVAILABILITY: BookAvailability = { total: 0, available: 0, onLoan: 0, reserved: 0 }

function isStaff(actor: JwtPayload): boolean {
  return LIBRARY_STAFF_ROLES.includes(actor.role)
}

export function toCopyItem(row: CopyRow, staff: boolean): BookCopyItem {
  const loan = staff ? row.loans[0] : undefined
  return {
    id: row.id,
    inventoryNumber: row.inventoryNumber,
    code: row.code,
    status: row.status,
    condition: row.condition,
    note: staff ? row.note : null,
    inventoriedAt: row.inventoriedAt?.toISOString() ?? null,
    loan: loan
      ? {
          id: loan.id,
          readerName: loan.readerName,
          readerGroup: loan.readerGroup,
          dueAt: loan.dueAt.toISOString(),
        }
      : null,
  }
}

function orderBy(query: BookListQueryInput): Prisma.BookOrderByWithRelationInput[] {
  const order = query.order ?? (query.sort === 'createdAt' ? 'desc' : 'asc')
  switch (query.sort) {
    case 'authors':
      return [{ authors: order }, { title: 'asc' }]
    case 'year':
      return [{ year: { sort: order, nulls: 'last' } }, { title: 'asc' }]
    case 'createdAt':
      return [{ createdAt: order }, { id: 'asc' }]
    default:
      return [{ title: order }, { id: 'asc' }]
  }
}

/** Нарушение уникальности инвентарного номера в вузе. */
function isInventoryClash(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false
  }
  const target = (error.meta?.target ?? []) as string[] | string
  return String(target).includes('inventory_number')
}

function isCodeClash(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    String(error.meta?.target ?? '').includes('code')
  )
}

@Injectable()
export class LibraryCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FileService,
    private readonly settings: LibrarySettingsService,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly reservations: LibraryReservationsService,
  ) {}

  // ── Чтение каталога ──────────────────────────────────────────────────────────────

  async list(actor: JwtPayload, query: BookListQueryInput): Promise<Paginated<BookCard>> {
    const universityId = await this.catalogUniversity(actor)
    const staff = isStaff(actor)
    const where: Prisma.BookWhereInput = {
      universityId,
      // Архив видят только те, кто ведёт фонд, и только когда попросили.
      archivedAt: staff && query.archived ? { not: null } : null,
      ...(query.section ? { section: query.section } : {}),
      ...(query.available ? { copies: { some: { status: 'AVAILABLE' } } } : {}),
      ...(query.q ? { OR: this.searchWhere(query.q) } : {}),
    }
    const { page, limit } = query
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.book.findMany({
        where,
        orderBy: orderBy(query),
        skip: (page - 1) * limit,
        take: limit,
        select: BOOK_SELECT,
      }),
      this.prisma.book.count({ where }),
    ])
    return new Paginated(await this.toCards(rows), { total })
  }

  /** Книга: тем, кто ведёт фонд, — с экземплярами; читателю — карточка с наличием. */
  async detail(actor: JwtPayload, id: string): Promise<BookDetail | BookCard> {
    const universityId = await this.catalogUniversity(actor)
    const staff = isStaff(actor)
    const book = await this.prisma.book.findUnique({ where: { id }, select: BOOK_SELECT })
    if (!book || book.universityId !== universityId || (!staff && book.archivedAt)) {
      throw new AppException('NOT_FOUND', 'Книга не найдена')
    }
    const card = await this.toCard(book)
    if (!staff) return card
    const copies = await this.prisma.bookCopy.findMany({
      where: { bookId: id },
      orderBy: { inventoryNumber: 'asc' },
      take: 500,
      select: COPY_SELECT,
    })
    return { ...card, copies: copies.map((c) => toCopyItem(c, true)) }
  }

  /** Разделы каталога вуза — для фильтра. */
  async sections(actor: JwtPayload): Promise<string[]> {
    const universityId = await this.catalogUniversity(actor)
    const rows = await this.prisma.book.findMany({
      where: { universityId, archivedAt: null, section: { not: null } },
      distinct: ['section'],
      orderBy: { section: 'asc' },
      select: { section: true },
      take: 200,
    })
    return rows.map((r) => r.section).filter((s): s is string => Boolean(s))
  }

  /**
   * Экземпляр по коду с наклейки. Тем, кто ведёт фонд, — с текущей выдачей; читателю —
   * только книга (он сканирует наклейку, чтобы найти книгу в каталоге). Чужой вуз и
   * неизвестный код — одинаковый NOT_FOUND (BACKEND_RULES §13.2).
   */
  async byCode(actor: JwtPayload, code: string): Promise<BookCopyByCode> {
    const universityId = await this.catalogUniversity(actor)
    const staff = isStaff(actor)
    const copy = await this.prisma.bookCopy.findUnique({
      where: { code: code.toUpperCase() },
      select: { ...COPY_SELECT, book: { select: BOOK_SELECT } },
    })
    if (!copy || copy.universityId !== universityId || (!staff && copy.book.archivedAt)) {
      throw new AppException('NOT_FOUND', 'Экземпляр не найден или наклейка устарела')
    }
    const book = await this.toCard(copy.book)
    return { copy: toCopyItem(copy, staff), book }
  }

  // ── Карточки книг ────────────────────────────────────────────────────────────────

  async create(actor: JwtPayload, input: CreateBookInput, ctx: RequestContext): Promise<BookCard> {
    const universityId = staffLibrary(actor)
    const book = await this.prisma.book.create({
      data: {
        universityId,
        title: input.title,
        authors: input.authors,
        isbn: input.isbn ?? null,
        publisher: input.publisher ?? null,
        year: input.year ?? null,
        section: input.section ?? null,
        description: input.description ?? null,
        createdById: actor.sub,
      },
      select: BOOK_SELECT,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'library_book_created',
      entity: 'Book',
      entityId: book.id,
      metadata: { universityId },
      ...ctx,
    })
    const card = await this.toCard(book)
    return card
  }

  async update(
    actor: JwtPayload,
    id: string,
    input: UpdateBookInput,
    ctx: RequestContext,
  ): Promise<BookCard> {
    const book = await this.ownedBook(actor, id)
    if (input.coverFileId) await this.assertCover(actor, input.coverFileId)
    if (input.archived === true && !book.archivedAt) {
      // Книга на руках или под бронью из каталога не уходит: читатель потерял бы её из виду.
      const busy = await this.prisma.bookCopy.count({
        where: { bookId: id, status: { in: ['ON_LOAN', 'RESERVED'] } },
      })
      if (busy > 0) {
        throw libraryConflict('copies', 'Экземпляры книги выданы или отложены под бронь')
      }
    }
    const { archived, ...fields } = input
    const updated = await this.prisma.book.update({
      where: { id },
      data: {
        ...fields,
        ...(archived === undefined
          ? {}
          : { archivedAt: archived ? (book.archivedAt ?? new Date()) : null }),
      },
      select: BOOK_SELECT,
    })
    if (archived === true && !book.archivedAt) {
      await this.reservations.closeQueueOfArchived(id, updated.title)
    }
    await this.audit.record({
      userId: actor.sub,
      action:
        archived === true
          ? 'library_book_archived'
          : archived === false
            ? 'library_book_restored'
            : 'library_book_updated',
      entity: 'Book',
      entityId: id,
      metadata: { universityId: book.universityId, fields: Object.keys(fields) },
      ...ctx,
    })
    const card = await this.toCard(updated)
    return card
  }

  /** Обложка книги: картинка ложится в медиа постов и привязывается к карточке. */
  async uploadCover(
    actor: JwtPayload,
    id: string,
    buffer: Buffer,
    ctx: RequestContext,
  ): Promise<BookCard> {
    await this.ownedBook(actor, id)
    const file = await this.files.upload({
      buffer,
      bucket: this.config.get('MINIO_BUCKET_POSTS', { infer: true }),
      ownerId: actor.sub,
      expectedCategory: 'IMAGE',
    })
    return this.update(actor, id, { coverFileId: file.id }, ctx)
  }

  // ── Экземпляры ───────────────────────────────────────────────────────────────────

  async addCopies(
    actor: JwtPayload,
    bookId: string,
    input: AddBookCopiesInput,
    ctx: RequestContext,
  ): Promise<BookCopyItem[]> {
    const book = await this.ownedBook(actor, bookId)
    if (book.archivedAt) throw libraryConflict('archived', 'Книга в архиве')
    const created = await this.createCopies(
      book.universityId,
      [{ bookId, inventoryNumbers: input.inventoryNumbers ?? [], count: input.count ?? 0 }],
      input.condition,
    )
    await this.audit.record({
      userId: actor.sub,
      action: 'library_copies_added',
      entity: 'Book',
      entityId: bookId,
      metadata: { universityId: book.universityId, count: created.length },
      ...ctx,
    })
    const rows = await this.prisma.bookCopy.findMany({
      where: { id: { in: created } },
      orderBy: { inventoryNumber: 'asc' },
      select: COPY_SELECT,
    })
    return rows.map((r) => toCopyItem(r, true))
  }

  /**
   * Заводит экземпляры пачкой под одним локом вуза: номера «по порядку» выдаются после
   * наибольшего числового номера, и два одновременных заведения их не повторят. Возвращает
   * id созданных экземпляров. Повтор номера — 409 с перечнем занятых.
   *
   * Пачки можно передать построителем: он выполняется в той же транзакции (импорт заводит
   * книги и экземпляры вместе — занятый номер не оставит книг без экземпляров).
   */
  async createCopies(
    universityId: string,
    batches: CopyBatch[] | ((tx: Prisma.TransactionClient) => Promise<CopyBatch[]>),
    condition: 'GOOD' | 'WORN' | 'DAMAGED' = 'GOOD',
  ): Promise<string[]> {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      try {
        const ids = await this.prisma.$transaction(
          async (tx) => {
            await advisoryXactLock(tx, `library:inventory:${universityId}`)
            const list = typeof batches === 'function' ? await batches(tx) : batches
            const explicit = list.flatMap((b) => b.inventoryNumbers)
            const repeated = explicit.filter((n, i) => explicit.indexOf(n) !== i)
            if (repeated.length > 0) {
              throw libraryConflict(
                'inventoryNumbers',
                `Номер повторяется: ${[...new Set(repeated)].join(', ')}`,
              )
            }
            if (explicit.length > 0) {
              const taken = await tx.bookCopy.findMany({
                where: { universityId, inventoryNumber: { in: explicit } },
                select: { inventoryNumber: true },
                take: 50,
              })
              if (taken.length > 0) {
                throw libraryConflict(
                  'inventoryNumbers',
                  `Номер уже есть в фонде: ${taken.map((t) => t.inventoryNumber).join(', ')}`,
                )
              }
            }
            let next = await this.nextNumericInventory(tx, universityId)
            const ids: string[] = []
            for (const batch of list) {
              const numbers = [...batch.inventoryNumbers]
              for (let i = 0; i < batch.count; i += 1) numbers.push(String(next++))
              for (const inventoryNumber of numbers) {
                const copy = await tx.bookCopy.create({
                  data: {
                    bookId: batch.bookId,
                    universityId,
                    inventoryNumber,
                    code: readableCode(COPY_CODE_LENGTH),
                    condition,
                  },
                  select: { id: true },
                })
                ids.push(copy.id)
              }
            }
            return ids
          },
          { timeout: 60_000 },
        )
        // Новые экземпляры сначала — тем, кто стоит в очереди на книгу (Фаза 20.8).
        await this.reservations.serveCopies(universityId, ids)
        return ids
      } catch (error) {
        if (isCodeClash(error)) continue
        if (isInventoryClash(error)) {
          throw libraryConflict('inventoryNumbers', 'Инвентарный номер уже есть в фонде')
        }
        throw error
      }
    }
    throw new AppException('INTERNAL_ERROR', 'Не удалось выдать коды наклеек — повторите')
  }

  async updateCopy(
    actor: JwtPayload,
    copyId: string,
    input: UpdateBookCopyInput,
    ctx: RequestContext,
  ): Promise<BookCopyItem> {
    const owned = await this.ownedCopy(actor, copyId)
    try {
      // Проверка статуса и запись — под локом очереди книги и условием на прежний статус:
      // выдача или бронь, взявшие экземпляр между чтением и записью, иначе получили бы
      // списанный экземпляр с открытой выдачей или готовой бронью (§3.11).
      const { copy, updated } = await this.prisma.$transaction(async (tx) => {
        await lockBookQueue(tx, owned.bookId)
        const copy = await tx.bookCopy.findUniqueOrThrow({
          where: { id: copyId },
          select: { status: true, inventoryNumber: true, universityId: true },
        })
        // Выдачу и бронь двигают сами выдачи и брони: руками — только вывод из оборота.
        const busy = copy.status === 'ON_LOAN' || copy.status === 'RESERVED'
        if (input.status && input.status !== copy.status && busy) {
          throw libraryConflict('status', 'Экземпляр выдан или отложен под бронь')
        }
        // В выдаче лежит номер на момент выдачи, по нему принимают возврат из списка выдач:
        // номер выданного экземпляра меняется после возврата, иначе «Принять» не найдёт
        // экземпляр или, хуже, закроет выдачу того, кому достался старый номер.
        if (
          input.inventoryNumber !== undefined &&
          input.inventoryNumber !== copy.inventoryNumber &&
          copy.status === 'ON_LOAN'
        ) {
          throw libraryConflict('status', 'Номер выданного экземпляра меняют после возврата')
        }
        const { count } = await tx.bookCopy.updateMany({
          where: { id: copyId, status: copy.status },
          data: {
            ...(input.inventoryNumber !== undefined
              ? { inventoryNumber: input.inventoryNumber }
              : {}),
            ...(input.condition !== undefined ? { condition: input.condition } : {}),
            ...(input.note !== undefined ? { note: input.note } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
          },
        })
        if (count === 0) throw libraryConflict('status', 'Экземпляр только что выдали')
        const updated = await tx.bookCopy.findUniqueOrThrow({
          where: { id: copyId },
          select: COPY_SELECT,
        })
        return { copy, updated }
      })
      await this.audit.record({
        userId: actor.sub,
        action:
          input.status && input.status !== copy.status
            ? input.status === 'AVAILABLE'
              ? 'library_copy_restored'
              : 'library_copy_withdrawn'
            : 'library_copy_updated',
        entity: 'BookCopy',
        entityId: copyId,
        metadata: {
          universityId: copy.universityId,
          fields: Object.keys(input),
          ...(input.status ? { from: copy.status, to: input.status } : {}),
        },
        ...ctx,
      })
      if (input.status === 'AVAILABLE' && copy.status !== 'AVAILABLE') {
        // Экземпляр вернулся в оборот — очередь на книгу получает его первой.
        await this.reservations.serveBook(copy.universityId, updated.bookId)
      }
      return toCopyItem(updated, true)
    } catch (error) {
      if (isInventoryClash(error)) {
        throw libraryConflict('inventoryNumber', 'Инвентарный номер уже есть в фонде')
      }
      throw error
    }
  }

  /** Перевыпуск кода наклейки: старая распечатка перестаёт работать (BACKEND_RULES §13.2). */
  async rotateCopyCode(
    actor: JwtPayload,
    copyId: string,
    ctx: RequestContext,
  ): Promise<BookCopyLabel> {
    const copy = await this.ownedCopy(actor, copyId)
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      try {
        await this.prisma.bookCopy.update({
          where: { id: copyId },
          data: { code: readableCode(COPY_CODE_LENGTH) },
        })
        await this.audit.record({
          userId: actor.sub,
          action: 'library_copy_code_rotated',
          entity: 'BookCopy',
          entityId: copyId,
          metadata: { universityId: copy.universityId, previousCode: copy.code },
          ...ctx,
        })
        const labels = await this.labels(actor, [copyId])
        const label = labels[0]
        if (!label) throw new AppException('NOT_FOUND', 'Экземпляр не найден')
        return label
      } catch (error) {
        if (isCodeClash(error)) continue
        throw error
      }
    }
    throw new AppException('INTERNAL_ERROR', 'Не удалось выдать код — повторите')
  }

  /** Наклейки для печати: QR ведёт на страницу экземпляра, а не содержит данные. */
  async labels(actor: JwtPayload, copyIds: string[]): Promise<BookCopyLabel[]> {
    const universityId = staffLibrary(actor)
    const copies = await this.prisma.bookCopy.findMany({
      where: { id: { in: copyIds }, universityId },
      orderBy: [{ book: { title: 'asc' } }, { inventoryNumber: 'asc' }],
      take: copyIds.length,
      select: {
        id: true,
        inventoryNumber: true,
        code: true,
        book: { select: { title: true, authors: true } },
        university: { select: { name: true, shortName: true } },
      },
    })
    if (copies.length !== new Set(copyIds).size) {
      throw new AppException('NOT_FOUND', 'Экземпляр не найден')
    }
    const base = webBaseUrl(this.config)
    return copies.map((c) => {
      const url = `${base}/c/${c.code}`
      return {
        copyId: c.id,
        inventoryNumber: c.inventoryNumber,
        code: c.code,
        title: c.book.title,
        authors: c.book.authors,
        university: c.university.shortName ?? c.university.name,
        url,
        qr: renderQrDataUrl(url, { margin: 1, width: QR_PRINT_WIDTH }),
      }
    })
  }

  // ── Внутреннее ───────────────────────────────────────────────────────────────────

  /**
   * Вуз, каталог которого виден актору. Тем, кто ведёт фонд, — всегда (фонд готовят и до
   * включения); читателю — только у включённой библиотеки.
   */
  async catalogUniversity(actor: JwtPayload): Promise<string> {
    const universityId = memberLibrary(actor)
    if (!isStaff(actor)) await this.settings.requireEnabled(universityId)
    return universityId
  }

  async toCard(row: BookRow): Promise<BookCard> {
    const cards = await this.toCards([row])
    const card = cards[0]
    if (!card) throw new AppException('NOT_FOUND', 'Книга не найдена')
    return card
  }

  /** Карточки с наличием и ссылкой на обложку — одним запросом на страницу. */
  async toCards(rows: BookRow[]): Promise<BookCard[]> {
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)
    const [groups, covers] = await Promise.all([
      this.prisma.bookCopy.groupBy({
        by: ['bookId', 'status'],
        where: { bookId: { in: ids } },
        _count: { _all: true },
      }),
      this.files.getPresignedUrls(
        rows.map((r) => r.coverFileId).filter((id): id is string => Boolean(id)),
      ),
    ])
    const availability = new Map<string, BookAvailability>()
    for (const g of groups) {
      const a = availability.get(g.bookId) ?? { ...EMPTY_AVAILABILITY }
      const n = g._count._all
      if (g.status === 'AVAILABLE') a.available += n
      if (g.status === 'ON_LOAN') a.onLoan += n
      if (g.status === 'RESERVED') a.reserved += n
      // Утерянные и списанные в фонд не входят.
      if (g.status !== 'LOST' && g.status !== 'WRITTEN_OFF') a.total += n
      availability.set(g.bookId, a)
    }
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      authors: r.authors,
      isbn: r.isbn,
      publisher: r.publisher,
      year: r.year,
      section: r.section,
      description: r.description,
      coverUrl: r.coverFileId ? (covers.get(r.coverFileId) ?? null) : null,
      archived: r.archivedAt !== null,
      availability: availability.get(r.id) ?? { ...EMPTY_AVAILABILITY },
    }))
  }

  private searchWhere(q: string): Prisma.BookWhereInput[] {
    const isbn = q.replace(/[\s-]/g, '').toUpperCase()
    return [
      { title: { contains: q, mode: 'insensitive' } },
      { authors: { contains: q, mode: 'insensitive' } },
      ...(/^[\dX]{4,13}$/.test(isbn) ? [{ isbn: { contains: isbn } }] : []),
    ]
  }

  /** Книга вуза того, кто ведёт фонд; чужая и несуществующая — одинаковый NOT_FOUND. */
  private async ownedBook(actor: JwtPayload, id: string): Promise<BookRow> {
    const universityId = staffLibrary(actor)
    const book = await this.prisma.book.findUnique({ where: { id }, select: BOOK_SELECT })
    if (!book || book.universityId !== universityId) {
      throw new AppException('NOT_FOUND', 'Книга не найдена')
    }
    return book
  }

  private async ownedCopy(
    actor: JwtPayload,
    id: string,
  ): Promise<{ id: string; universityId: string; bookId: string; status: string; code: string }> {
    const universityId = staffLibrary(actor)
    const copy = await this.prisma.bookCopy.findUnique({
      where: { id },
      select: { id: true, universityId: true, bookId: true, status: true, code: true },
    })
    if (!copy || copy.universityId !== universityId) {
      throw new AppException('NOT_FOUND', 'Экземпляр не найден')
    }
    return copy
  }

  /** Обложкой можно сделать только свою загруженную картинку. */
  private async assertCover(actor: JwtPayload, fileId: string): Promise<void> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      select: { ownerId: true, mime: true },
    })
    if (!file || file.ownerId !== actor.sub || !file.mime.startsWith('image/')) {
      throw new AppException('VALIDATION_ERROR', 'Обложка — своя загруженная картинка', [
        { field: 'coverFileId', message: 'Неверный файл обложки' },
      ])
    }
  }

  /** Следующий номер после наибольшего числового инвентарного номера вуза. */
  private async nextNumericInventory(
    tx: Prisma.TransactionClient,
    universityId: string,
  ): Promise<number> {
    const rows = await tx.$queryRaw<{ max: bigint | null }[]>`
      SELECT max(inventory_number::bigint) AS max
      FROM book_copies
      WHERE university_id = ${universityId} AND inventory_number ~ '^[0-9]{1,15}$'`
    const max = rows[0]?.max
    return max === null || max === undefined ? 1 : Number(max) + 1
  }
}
