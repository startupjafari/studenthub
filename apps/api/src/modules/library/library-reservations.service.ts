import { Injectable, Logger } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type { ReservationItem, ReservationListQueryInput } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import { NOTIFICATION_JOBS } from '../../common/queue/queue.constants'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { FileService } from '../files/file.service'
import { LibrarySettingsService } from './library-settings.service'
import { LibraryLoansService } from './library-loans.service'
import { LibraryNotifier } from './library-notifier'
import { todayIn } from './library-dates'
import { lockBookQueue, releaseCopy, serveQueue, type HeldFor } from './library-holds'
import { libraryConflict, librarianLibrary, readerLibrary, staffLibrary } from './library-scope'

// Брони библиотеки (Фаза 20.8, docs/PROJECT.md §3.11). Читатель встаёт в очередь на книгу;
// есть свободный экземпляр — бронь сразу «готова», экземпляр откладывается на полку броней.
// Иначе ждёт: возвращённый экземпляр достаётся первому в очереди (library-holds.ts). Готовая
// бронь держится `reservationHoldDays` дней и истекает сама (cron `expireLibraryHolds`).

const BATCH_SIZE = 500
/**
 * Готовую бронь cron дошлёт не раньше, чем через столько: уведомление, поставленное сразу
 * после транзакции, к этому времени уже отмечено, и повтора не будет.
 */
const READY_NOTICE_GRACE_MS = 5 * 60 * 1000
/** «Мои брони»: действующие (их не больше предела вуза) и недавняя история. */
const MY_RESERVATIONS = 50
const MY_HISTORY = 20

const RESERVATION_SELECT = {
  id: true,
  universityId: true,
  bookId: true,
  readerId: true,
  status: true,
  createdAt: true,
  readyAt: true,
  holdUntil: true,
  closedAt: true,
  copyId: true,
  book: { select: { id: true, title: true, authors: true, coverFileId: true } },
  copy: { select: { id: true, inventoryNumber: true } },
  reader: {
    select: { id: true, firstName: true, lastName: true, group: { select: { name: true } } },
  },
} satisfies Prisma.ReservationSelect

type ReservationRow = Prisma.ReservationGetPayload<{ select: typeof RESERVATION_SELECT }>

@Injectable()
export class LibraryReservationsService {
  private readonly logger = new Logger(LibraryReservationsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FileService,
    private readonly settings: LibrarySettingsService,
    private readonly loans: LibraryLoansService,
    private readonly notifier: LibraryNotifier,
  ) {}

  // ── Читатель ─────────────────────────────────────────────────────────────────────

  /**
   * Бронь книги: та же проверка читателя, что и при выдаче (статус, просрочка), предел
   * действующих броней, одна бронь на книгу. Книга без экземпляров в обороте — `409 noCopies`.
   */
  async reserve(actor: JwtPayload, bookId: string, ctx: RequestContext): Promise<ReservationItem> {
    const universityId = readerLibrary(actor)
    const settings = await this.settings.requireEnabled(universityId)
    const reader = await this.loans.readerOf(universityId, actor.sub)
    const book = await this.prisma.book.findUnique({
      where: { id: bookId },
      select: { id: true, universityId: true, title: true, archivedAt: true },
    })
    if (!book || book.universityId !== universityId || book.archivedAt) {
      throw new AppException('NOT_FOUND', 'Книга не найдена')
    }
    const eligibility = await this.loans.eligibility(reader, settings.maxActiveLoans)
    const blocker = eligibility.blockers.find((b) => b !== 'limit')
    if (blocker) throw this.loans.blockerConflict(blocker)

    const [active, sameBook, borrowed, inCirculation] = await Promise.all([
      this.prisma.reservation.count({
        where: { readerId: reader.id, status: { in: ['QUEUED', 'READY'] } },
      }),
      this.prisma.reservation.count({
        where: { readerId: reader.id, bookId, status: { in: ['QUEUED', 'READY'] } },
      }),
      this.prisma.loan.count({
        where: { readerId: reader.id, status: 'OPEN', copy: { bookId } },
      }),
      this.prisma.bookCopy.count({
        where: { bookId, status: { in: ['AVAILABLE', 'ON_LOAN', 'RESERVED'] } },
      }),
    ])
    if (sameBook > 0) throw libraryConflict('alreadyReserved', 'Книга уже забронирована вами')
    if (borrowed > 0) throw libraryConflict('alreadyBorrowed', 'Эта книга уже у вас на руках')
    if (active >= settings.maxActiveReservations) {
      throw libraryConflict('reservationLimit', 'Достигнут предел броней')
    }
    if (inCirculation === 0) throw libraryConflict('noCopies', 'Экземпляров этой книги нет')

    const timezone = await this.loans.timezoneOf(universityId)
    const { id, held } = await this.prisma.$transaction(async (tx) => {
      await lockBookQueue(tx, bookId)
      // Под локом: две одновременные брони одного читателя на книгу не пройдут обе.
      const dup = await tx.reservation.count({
        where: { readerId: reader.id, bookId, status: { in: ['QUEUED', 'READY'] } },
      })
      if (dup > 0) throw libraryConflict('alreadyReserved', 'Книга уже забронирована вами')
      const created = await tx.reservation.create({
        data: { universityId, bookId, readerId: reader.id },
        select: { id: true },
      })
      const served = await serveQueue(tx, bookId, {
        holdDays: settings.reservationHoldDays,
        timezone,
      })
      // Своя готовая бронь видна читателю в ответе — догонять её уведомлением незачем.
      if (served.some((h) => h.reservationId === created.id)) {
        await tx.reservation.update({
          where: { id: created.id },
          data: { readyNotifiedAt: new Date() },
        })
      }
      return { id: created.id, held: served }
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'library_reservation_created',
      entity: 'Reservation',
      entityId: id,
      metadata: { universityId, bookId },
      ...ctx,
    })
    // Свою готовую бронь читатель видит в ответе; остальным, кого обслужила очередь, — уведомление.
    await this.notifyAll(
      held.filter((h) => h.reservationId !== id),
      book.title,
      timezone,
    )
    return this.item(id, timezone)
  }

  /** Отмена своей брони; готовая — экземпляр уходит следующему в очереди или на полку. */
  async cancelMine(actor: JwtPayload, id: string, ctx: RequestContext): Promise<ReservationItem> {
    const universityId = readerLibrary(actor)
    const row = await this.prisma.reservation.findUnique({
      where: { id },
      select: { readerId: true, universityId: true },
    })
    if (!row || row.readerId !== actor.sub || row.universityId !== universityId) {
      throw new AppException('NOT_FOUND', 'Бронь не найдена')
    }
    return this.close(actor, id, 'CANCELLED', ctx)
  }

  /** Мои брони: действующие (готовые — первыми), затем недавняя история. */
  async mine(actor: JwtPayload): Promise<ReservationItem[]> {
    const universityId = readerLibrary(actor)
    const [active, history] = await Promise.all([
      this.prisma.reservation.findMany({
        where: { readerId: actor.sub, universityId, status: { in: ['READY', 'QUEUED'] } },
        orderBy: [{ readyAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        take: MY_RESERVATIONS,
        select: RESERVATION_SELECT,
      }),
      this.prisma.reservation.findMany({
        where: {
          readerId: actor.sub,
          universityId,
          status: { in: ['FULFILLED', 'CANCELLED', 'EXPIRED'] },
        },
        orderBy: [{ closedAt: 'desc' }, { id: 'asc' }],
        take: MY_HISTORY,
        select: RESERVATION_SELECT,
      }),
    ])
    const rows = [...active, ...history]
    return this.toItems(rows, await this.loans.timezoneOf(universityId))
  }

  // ── Библиотекарь ─────────────────────────────────────────────────────────────────

  /** Брони вуза: полка броней (готовые), очередь, закрытые. */
  async list(
    actor: JwtPayload,
    query: ReservationListQueryInput,
  ): Promise<Paginated<ReservationItem>> {
    const universityId = staffLibrary(actor)
    const status: Prisma.ReservationWhereInput['status'] =
      query.filter === 'active'
        ? { in: ['QUEUED', 'READY'] }
        : query.filter === 'ready'
          ? 'READY'
          : query.filter === 'queued'
            ? 'QUEUED'
            : query.filter === 'closed'
              ? { in: ['FULFILLED', 'CANCELLED', 'EXPIRED'] }
              : undefined
    const where: Prisma.ReservationWhereInput = {
      universityId,
      ...(status ? { status } : {}),
      ...(query.bookId ? { bookId: query.bookId } : {}),
      ...(query.q
        ? {
            OR: [
              { book: { title: { contains: query.q, mode: 'insensitive' } } },
              { reader: { lastName: { contains: query.q, mode: 'insensitive' } } },
              { reader: { firstName: { contains: query.q, mode: 'insensitive' } } },
              { copy: { inventoryNumber: { contains: query.q } } },
            ],
          }
        : {}),
    }
    const orderBy: Prisma.ReservationOrderByWithRelationInput[] =
      query.filter === 'ready'
        ? [{ holdUntil: 'asc' }, { id: 'asc' }]
        : [{ createdAt: query.filter === 'closed' || query.filter === 'all' ? 'desc' : 'asc' }]
    const { page, limit } = query
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.reservation.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: RESERVATION_SELECT,
      }),
      this.prisma.reservation.count({ where }),
    ])
    return new Paginated(await this.toItems(rows, await this.loans.timezoneOf(universityId)), {
      total,
    })
  }

  /** Библиотекарь снимает бронь (читатель попросил, книга не нужна). */
  async cancelByStaff(
    actor: JwtPayload,
    id: string,
    ctx: RequestContext,
  ): Promise<ReservationItem> {
    const universityId = librarianLibrary(actor)
    const row = await this.prisma.reservation.findUnique({
      where: { id },
      select: { universityId: true },
    })
    if (!row || row.universityId !== universityId) {
      throw new AppException('NOT_FOUND', 'Бронь не найдена')
    }
    return this.close(actor, id, 'CANCELLED', ctx)
  }

  /**
   * Удаление аккаунта читателя (UserService.softDeleteSelf): действующие брони закрываются,
   * отложенный под готовую бронь экземпляр уходит следующему в очереди или на полку. Иначе
   * очередь отдавала экземпляр «Удалённому пользователю» на весь срок брони, а остальные
   * ждали. Уведомлений удалённому нет: закрывает он сам (actorId = readerId).
   */
  async cancelAllOfReader(readerId: string): Promise<number> {
    const rows = await this.prisma.reservation.findMany({
      where: { readerId, status: { in: ['QUEUED', 'READY'] } },
      select: { id: true },
      take: MY_RESERVATIONS,
    })
    const now = new Date()
    let closed = 0
    for (const row of rows) {
      if (await this.closeRow(row.id, 'CANCELLED', now, readerId)) closed++
    }
    return closed
  }

  // ── Экземпляры, появившиеся в обороте ────────────────────────────────────────────

  /**
   * Книга получила свободные экземпляры (завели новые, вернули списанный в оборот) — отдать
   * их очереди. Вызывает каталог после своей транзакции.
   */
  async serveBook(universityId: string, bookId: string): Promise<void> {
    const settings = await this.settings.get(universityId)
    const timezone = await this.loans.timezoneOf(universityId)
    const held = await this.prisma.$transaction((tx) =>
      serveQueue(tx, bookId, { holdDays: settings.reservationHoldDays, timezone }),
    )
    if (held.length === 0) return
    const book = await this.prisma.book.findUnique({
      where: { id: bookId },
      select: { title: true },
    })
    await this.notifyAll(held, book?.title ?? '', timezone)
  }

  /** Заведённые экземпляры — очередям их книг (экземпляры, импорт). */
  async serveCopies(universityId: string, copyIds: string[]): Promise<void> {
    if (copyIds.length === 0) return
    const queued = await this.prisma.reservation.findMany({
      where: {
        universityId,
        status: 'QUEUED',
        book: { copies: { some: { id: { in: copyIds } } } },
      },
      distinct: ['bookId'],
      select: { bookId: true },
      take: 1000,
    })
    for (const { bookId } of queued) await this.serveBook(universityId, bookId)
  }

  // ── Cron: истечение готовых броней ───────────────────────────────────────────────

  /** Готовые брони, которые не забрали к сроку, → EXPIRED; экземпляр — следующему. */
  async expireDue(now = new Date()): Promise<number> {
    let expired = 0
    let cursor: string | undefined
    for (;;) {
      const rows = await this.prisma.reservation.findMany({
        where: {
          status: 'READY',
          holdUntil: { lt: now },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: { id: true },
      })
      for (const row of rows) {
        try {
          const done = await this.closeRow(row.id, 'EXPIRED', now)
          if (done) expired += 1
        } catch (error) {
          this.logger.warn({ err: error, reservationId: row.id }, 'Бронь не закрылась по сроку')
        }
      }
      if (rows.length < BATCH_SIZE) break
      cursor = rows[rows.length - 1]?.id
    }
    if (expired > 0) this.logger.log(`expireLibraryHolds: истекло броней ${expired}`)
    return expired
  }

  /**
   * Догонялка «бронь готова»: готовые брони, чьё уведомление очередь не приняла (Redis
   * лежал в момент возврата или отмены). Без неё читатель не узнал бы о брони, и она
   * истекла бы впустую. Повтор безопасен: у уведомления тот же ключ дедупа. На первой
   * неудаче останавливаемся — очередь всё ещё недоступна, остаток уйдёт следующим тиком.
   */
  async notifyReadyPending(now = new Date()): Promise<number> {
    let sent = 0
    let cursor: string | undefined
    const timezones = new Map<string, string>()
    for (;;) {
      const rows = await this.prisma.reservation.findMany({
        where: {
          status: 'READY',
          readyNotifiedAt: null,
          holdUntil: { gte: now },
          readyAt: { lt: new Date(now.getTime() - READY_NOTICE_GRACE_MS) },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: {
          id: true,
          universityId: true,
          readerId: true,
          holdUntil: true,
          book: { select: { title: true } },
        },
      })
      for (const row of rows) {
        if (!row.holdUntil) continue
        let timezone = timezones.get(row.universityId)
        if (!timezone) {
          timezone = await this.loans.timezoneOf(row.universityId)
          timezones.set(row.universityId, timezone)
        }
        const ok = await this.loans.notifyHeld(
          {
            reservationId: row.id,
            readerId: row.readerId,
            name: '',
            group: null,
            holdUntil: row.holdUntil,
          },
          row.book.title,
          timezone,
        )
        if (!ok) {
          this.logger.warn(`notifyReadyPending: очередь недоступна, дослано ${sent}`)
          return sent
        }
        sent += 1
      }
      if (rows.length < BATCH_SIZE) break
      cursor = rows[rows.length - 1]?.id
    }
    if (sent > 0) this.logger.log(`notifyReadyPending: дослано «бронь готова» ${sent}`)
    return sent
  }

  // ── Внутреннее ───────────────────────────────────────────────────────────────────

  private async close(
    actor: JwtPayload,
    id: string,
    status: 'CANCELLED',
    ctx: RequestContext,
  ): Promise<ReservationItem> {
    const done = await this.closeRow(id, status, new Date(), actor.sub)
    if (!done) throw libraryConflict('closed', 'Бронь уже закрыта')
    await this.audit.record({
      userId: actor.sub,
      action: 'library_reservation_cancelled',
      entity: 'Reservation',
      entityId: id,
      metadata: { universityId: done.universityId, bookId: done.bookId, by: actor.role },
      ...ctx,
    })
    return this.item(id, done.timezone)
  }

  /**
   * Закрывает действующую бронь (отмена или истечение) и, если экземпляр был отложен, отдаёт
   * его следующему в очереди. Читателю — уведомление, кроме отмены им самим.
   */
  private async closeRow(
    id: string,
    status: 'CANCELLED' | 'EXPIRED',
    now: Date,
    actorId?: string,
  ): Promise<{ universityId: string; bookId: string; timezone: string } | null> {
    const row = await this.prisma.reservation.findUnique({
      where: { id },
      select: {
        universityId: true,
        bookId: true,
        readerId: true,
        copyId: true,
        book: { select: { title: true } },
      },
    })
    if (!row) return null
    const settings = await this.settings.get(row.universityId)
    const timezone = await this.loans.timezoneOf(row.universityId)
    const held = await this.prisma.$transaction(async (tx) => {
      await lockBookQueue(tx, row.bookId)
      const { count } = await tx.reservation.updateMany({
        where: {
          id,
          status: status === 'EXPIRED' ? 'READY' : { in: ['QUEUED', 'READY'] },
        },
        data: { status, closedAt: now },
      })
      if (count === 0) return undefined
      const current = await tx.reservation.findUniqueOrThrow({
        where: { id },
        select: { copyId: true },
      })
      if (!current.copyId) return null
      return releaseCopy(
        tx,
        { id: current.copyId, bookId: row.bookId },
        { holdDays: settings.reservationHoldDays, timezone },
        now,
      )
    })
    if (held === undefined) return null
    if (actorId !== row.readerId) {
      await this.notifier.send({
        recipientIds: [row.readerId],
        job: NOTIFICATION_JOBS.LIBRARY_RESERVATION,
        titleKey:
          status === 'EXPIRED'
            ? 'library.reservationExpired.title'
            : 'library.reservationCancelled.title',
        bodyKey: 'library.book.body',
        params: { title: row.book.title },
        url: '/my-books',
        dedupeKey: `library-reservation-${status.toLowerCase()}:${id}`,
      })
    }
    await this.loans.notifyHeld(held, row.book.title, timezone)
    return { universityId: row.universityId, bookId: row.bookId, timezone }
  }

  private async notifyAll(held: HeldFor[], title: string, timezone: string): Promise<void> {
    for (const h of held) await this.loans.notifyHeld(h, title, timezone)
  }

  private async item(id: string, timezone: string): Promise<ReservationItem> {
    const row = await this.prisma.reservation.findUniqueOrThrow({
      where: { id },
      select: RESERVATION_SELECT,
    })
    const [item] = await this.toItems([row], timezone)
    if (!item) throw new AppException('INTERNAL_ERROR', 'Бронь не найдена')
    return item
  }

  /** Строки → ответ: место в очереди — одним запросом по книгам, обложки — одним запросом. */
  async toItems(rows: ReservationRow[], timezone: string): Promise<ReservationItem[]> {
    const queuedBooks = [...new Set(rows.filter((r) => r.status === 'QUEUED').map((r) => r.bookId))]
    const queue =
      queuedBooks.length > 0
        ? await this.prisma.reservation.findMany({
            where: { bookId: { in: queuedBooks }, status: 'QUEUED' },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 5000,
            select: { id: true, bookId: true },
          })
        : []
    const position = new Map<string, number>()
    const seen = new Map<string, number>()
    for (const q of queue) {
      const n = (seen.get(q.bookId) ?? 0) + 1
      seen.set(q.bookId, n)
      position.set(q.id, n)
    }
    const covers = await this.files.getPresignedUrls(
      rows.map((r) => r.book.coverFileId).filter((v): v is string => Boolean(v)),
    )
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      readyAt: r.readyAt?.toISOString() ?? null,
      holdUntil: r.holdUntil?.toISOString() ?? null,
      holdDate: r.holdUntil ? todayIn(timezone, r.holdUntil) : null,
      closedAt: r.closedAt?.toISOString() ?? null,
      position: r.status === 'QUEUED' ? (position.get(r.id) ?? null) : null,
      book: {
        id: r.book.id,
        title: r.book.title,
        authors: r.book.authors,
        coverUrl: r.book.coverFileId ? (covers.get(r.book.coverFileId) ?? null) : null,
      },
      copy: r.status === 'READY' && r.copy ? r.copy : null,
      reader: {
        id: r.reader.id,
        name: `${r.reader.lastName} ${r.reader.firstName}`,
        group: r.reader.group?.name ?? null,
      },
    }))
  }
}
