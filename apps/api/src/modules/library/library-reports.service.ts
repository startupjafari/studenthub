import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type {
  InventoryQueryInput,
  InventoryReport,
  InventoryScanInput,
  InventoryScanResult,
  InventoryWarning,
  LibrarySummary,
  PopularBook,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { FileService } from '../files/file.service'
import { LibraryLoansService } from './library-loans.service'
import { startOfDay, todayIn } from './library-dates'
import { librarianLibrary, staffLibrary } from './library-scope'

// Отчёты библиотеки и инвентаризация (Фаза 20.12, docs/PROJECT.md §3.11). Сводка фонда и
// выдач, популярное за период; должники — это список выдач с фильтром `overdue`, история
// экземпляра — `GET /library/loans?copyId=`. Инвентаризация — скан наклеек: каждый
// отмеченный экземпляр получает `inventoriedAt`, а отчёт показывает, что из «должно стоять
// на полке» с начала инвентаризации так и не нашли.

const DAY_MS = 86_400_000
const POPULAR_LIMIT = 20

const WARNING: Partial<Record<string, InventoryWarning>> = {
  ON_LOAN: 'onLoan',
  LOST: 'lost',
  WRITTEN_OFF: 'writtenOff',
}

@Injectable()
export class LibraryReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileService,
    private readonly loans: LibraryLoansService,
  ) {}

  async summary(actor: JwtPayload): Promise<LibrarySummary> {
    const universityId = staffLibrary(actor)
    const now = new Date()
    const monthAgo = new Date(now.getTime() - 30 * DAY_MS)
    const [books, copies, open, overdue, issued, returned, readers, reservations] =
      await Promise.all([
        this.prisma.book.count({ where: { universityId, archivedAt: null } }),
        this.prisma.bookCopy.groupBy({
          by: ['status'],
          where: { universityId },
          _count: { _all: true },
        }),
        this.prisma.loan.count({ where: { universityId, status: 'OPEN' } }),
        this.prisma.loan.count({ where: { universityId, status: 'OPEN', dueAt: { lt: now } } }),
        this.prisma.loan.count({
          where: { universityId, issuedAt: { gte: monthAgo }, status: { not: 'CANCELLED' } },
        }),
        this.prisma.loan.count({
          where: { universityId, status: 'RETURNED', returnedAt: { gte: monthAgo } },
        }),
        // Читателей считаем в базе: выдач у вуза могут быть десятки тысяч. Должник — с
        // просрочкой или с утерянной книгой, долг за которую не погашен: пока не погашен,
        // он считается как просрочка (§3.11).
        this.prisma.$queryRaw<{ withLoans: number; debtors: number }[]>`
          SELECT count(DISTINCT reader_id) FILTER (WHERE status = 'OPEN')::int AS "withLoans",
                 count(DISTINCT reader_id) FILTER (
                   WHERE (status = 'OPEN' AND due_at < ${now}) OR status = 'LOST'
                 )::int AS "debtors"
          FROM loans
          WHERE university_id = ${universityId}
            AND (status = 'OPEN' OR (status = 'LOST' AND lost_settled_at IS NULL))`,
        this.prisma.reservation.groupBy({
          by: ['status'],
          where: { universityId, status: { in: ['QUEUED', 'READY'] } },
          _count: { _all: true },
        }),
      ])
    const byStatus = (status: string): number =>
      copies.find((c) => c.status === status)?._count._all ?? 0
    const held = (status: string): number =>
      reservations.find((r) => r.status === status)?._count._all ?? 0
    const available = byStatus('AVAILABLE')
    const onLoan = byStatus('ON_LOAN')
    const reserved = byStatus('RESERVED')
    return {
      books,
      copies: {
        total: available + onLoan + reserved,
        available,
        onLoan,
        reserved,
        lost: byStatus('LOST'),
        writtenOff: byStatus('WRITTEN_OFF'),
      },
      loans: { open, overdue, issuedLast30: issued, returnedLast30: returned },
      readers: { withLoans: readers[0]?.withLoans ?? 0, debtors: readers[0]?.debtors ?? 0 },
      reservations: { queued: held('QUEUED'), ready: held('READY') },
    }
  }

  /** Самые выдаваемые книги за период. */
  async popular(actor: JwtPayload, days: number): Promise<PopularBook[]> {
    const universityId = staffLibrary(actor)
    const from = new Date(Date.now() - days * DAY_MS)
    const rows = await this.prisma.$queryRaw<{ bookId: string; loans: number }[]>(Prisma.sql`
      SELECT bc.book_id AS "bookId", count(*)::int AS "loans"
      FROM loans l
      JOIN book_copies bc ON bc.id = l.copy_id
      WHERE l.university_id = ${universityId}
        AND l.issued_at >= ${from}
        AND l.status <> 'CANCELLED'
      GROUP BY bc.book_id
      ORDER BY count(*) DESC, bc.book_id
      LIMIT ${POPULAR_LIMIT}`)
    if (rows.length === 0) return []
    const books = await this.prisma.book.findMany({
      where: { id: { in: rows.map((r) => r.bookId) } },
      select: { id: true, title: true, authors: true, coverFileId: true },
      take: POPULAR_LIMIT,
    })
    const covers = await this.files.getPresignedUrls(
      books.map((b) => b.coverFileId).filter((v): v is string => Boolean(v)),
    )
    const byId = new Map(books.map((b) => [b.id, b]))
    return rows.flatMap((r) => {
      const b = byId.get(r.bookId)
      if (!b) return []
      return [
        {
          book: {
            id: b.id,
            title: b.title,
            authors: b.authors,
            coverUrl: b.coverFileId ? (covers.get(b.coverFileId) ?? null) : null,
          },
          loans: r.loans,
        },
      ]
    })
  }

  // ── Инвентаризация ───────────────────────────────────────────────────────────────

  /** Скан экземпляра: «на месте». Странный статус не меняем, а показываем — решает человек. */
  async scan(actor: JwtPayload, input: InventoryScanInput): Promise<InventoryScanResult> {
    const universityId = librarianLibrary(actor)
    const copy = await this.loans.findCopy(universityId, input)
    const timezone = await this.loans.timezoneOf(universityId)
    const since = startOfDay(input.since ?? todayIn(timezone), timezone)
    const before = await this.prisma.bookCopy.findUnique({
      where: { id: copy.id },
      select: { inventoriedAt: true, book: { select: { authors: true } } },
    })
    await this.prisma.bookCopy.update({
      where: { id: copy.id },
      data: { inventoriedAt: new Date() },
    })
    return {
      copy: { id: copy.id, inventoryNumber: copy.inventoryNumber, status: copy.status },
      book: { id: copy.book.id, title: copy.book.title, authors: before?.book.authors ?? '' },
      alreadyChecked: Boolean(before?.inventoriedAt && before.inventoriedAt >= since),
      warning: WARNING[copy.status] ?? null,
    }
  }

  /** Ход инвентаризации: сколько отмечено и чего из «должно быть на полке» не нашли. */
  async inventory(actor: JwtPayload, query: InventoryQueryInput): Promise<InventoryReport> {
    const universityId = staffLibrary(actor)
    const timezone = await this.loans.timezoneOf(universityId)
    const since = startOfDay(query.since, timezone)
    const expectedWhere: Prisma.BookCopyWhereInput = {
      universityId,
      status: { in: ['AVAILABLE', 'RESERVED'] },
    }
    const missingWhere: Prisma.BookCopyWhereInput = {
      ...expectedWhere,
      OR: [{ inventoriedAt: null }, { inventoriedAt: { lt: since } }],
    }
    const { page, limit } = query
    const [expected, missing, onLoan, rows] = await Promise.all([
      this.prisma.bookCopy.count({ where: expectedWhere }),
      this.prisma.bookCopy.count({ where: missingWhere }),
      this.prisma.bookCopy.count({ where: { universityId, status: 'ON_LOAN' } }),
      this.prisma.bookCopy.findMany({
        where: missingWhere,
        orderBy: [{ inventoryNumber: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          inventoryNumber: true,
          status: true,
          inventoriedAt: true,
          book: { select: { id: true, title: true, authors: true } },
        },
      }),
    ])
    return {
      since: query.since,
      expected,
      checked: expected - missing,
      onLoan,
      items: rows.map((r) => ({
        copyId: r.id,
        inventoryNumber: r.inventoryNumber,
        status: r.status,
        inventoriedAt: r.inventoriedAt?.toISOString() ?? null,
        book: r.book,
      })),
      total: missing,
      page,
      limit,
    }
  }
}
