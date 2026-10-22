import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma, type BookCopyStatus } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  IssueLoanInput,
  LibraryReader,
  LibraryReaderSession,
  LoanItem,
  LoanListQueryInput,
  ReaderBlocker,
  ReaderEligibility,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import { NOTIFICATION_JOBS } from '../../common/queue/queue.constants'
import type { EnvVars } from '../../config/env.schema'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { FileService } from '../files/file.service'
import { StudentIdService } from '../student-id/student-id.service'
import { LibrarySettingsService } from './library-settings.service'
import { LibraryNotifier } from './library-notifier'
import { addDays, daysBetween, endOfDay, formatDay, todayIn } from './library-dates'
import { issueReaderTicket, readTicket } from './library-ticket'
import {
  READER_ROLES,
  libraryConflict,
  librarianLibrary,
  readerLibrary,
  staffLibrary,
} from './library-scope'

// Выдачи библиотеки (Фаза 20.4, docs/PROJECT.md §3.11). Выдаёт только библиотекарь, у каждой
// выдачи один ответственный. Читатель подтверждает себя QR цифрового студенческого: скан
// разовый, библиотекарь получает пропуск на 15 минут и выдаёт по нему одну книгу или
// несколько. Выдачи не правятся задним числом — только отменяются (20.5).

/**
 * Статусы студента, при которых книги не выдаются. Статус — строка из справочника вуза
 * (apps/web shared/config/profile-enums.ts, ACADEMIC_STATUS_DICT), не enum: сравниваем без
 * учёта регистра. Академический отпуск книгам не мешает.
 */
const BLOCKED_ACADEMIC_STATUSES = ['отчислен', 'выпускник', 'переведён', 'переведен']

/** Сколько недавних выдач читателя показать библиотекарю рядом с карточкой. */
const SESSION_LOANS = 20

export const LOAN_SELECT = {
  id: true,
  universityId: true,
  status: true,
  issuedAt: true,
  dueAt: true,
  renewals: true,
  returnedAt: true,
  cancelledAt: true,
  cancelReason: true,
  disputedAt: true,
  readerId: true,
  readerName: true,
  readerGroup: true,
  readerCard: true,
  bookTitle: true,
  inventoryNumber: true,
  copyId: true,
  copy: {
    select: {
      book: { select: { id: true, title: true, authors: true, coverFileId: true } },
    },
  },
  issuedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.LoanSelect

export type LoanRow = Prisma.LoanGetPayload<{ select: typeof LOAN_SELECT }>

const READER_SELECT = {
  id: true,
  role: true,
  universityId: true,
  firstName: true,
  lastName: true,
  middleName: true,
  avatarUrl: true,
  avatarThumbUrl: true,
  studentCardNumber: true,
  academicStatus: true,
  course: true,
  group: { select: { name: true } },
  faculty: { select: { name: true } },
} satisfies Prisma.UserSelect

type ReaderRow = Prisma.UserGetPayload<{ select: typeof READER_SELECT }>

function fullName(r: { lastName: string; firstName: string; middleName?: string | null }): string {
  return [r.lastName, r.firstName, r.middleName].filter(Boolean).join(' ')
}

export function toReader(row: ReaderRow): LibraryReader {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    middleName: row.middleName,
    avatarUrl: row.avatarThumbUrl ?? row.avatarUrl,
    group: row.group?.name ?? null,
    faculty: row.faculty?.name ?? null,
    studentCardNumber: row.studentCardNumber,
    academicStatus: row.academicStatus,
    course: row.course,
  }
}

function isBlockedStatus(status: string | null): boolean {
  return status !== null && BLOCKED_ACADEMIC_STATUSES.includes(status.trim().toLowerCase())
}

@Injectable()
export class LibraryLoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FileService,
    private readonly studentId: StudentIdService,
    private readonly settings: LibrarySettingsService,
    private readonly notifier: LibraryNotifier,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  // ── Сверка читателя ──────────────────────────────────────────────────────────────

  /**
   * Скан студенческого: проверка QR (разовый, тот же вуз — StudentIdService), карточка
   * читателя без лишних полей, может ли он брать книги, его выдачи и пропуск на выдачу.
   */
  async resolveReader(
    actor: JwtPayload,
    token: string,
    ctx: RequestContext,
  ): Promise<LibraryReaderSession> {
    const universityId = librarianLibrary(actor)
    const settings = await this.settings.requireEnabled(universityId)
    const card = await this.studentId.verify(actor, token, ctx)
    const reader = await this.readerOf(universityId, card.id)
    const timezone = await this.timezoneOf(universityId)
    const today = todayIn(timezone)
    const { ticket, expiresAt } = issueReaderTicket(this.config, reader.id, actor.sub, universityId)
    const loans = await this.prisma.loan.findMany({
      where: { readerId: reader.id, universityId },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
      take: SESSION_LOANS,
      select: LOAN_SELECT,
    })
    return {
      reader: toReader(reader),
      eligibility: await this.eligibility(reader, settings.maxActiveLoans),
      ticket,
      ticketExpiresAt: expiresAt.toISOString(),
      loans: await this.toItems(loans, timezone),
      defaultDueDate: addDays(today, settings.defaultLoanDays),
      maxDueDate: addDays(today, settings.maxLoanDays),
    }
  }

  // ── Выдача ───────────────────────────────────────────────────────────────────────

  async issue(actor: JwtPayload, input: IssueLoanInput, ctx: RequestContext): Promise<LoanItem> {
    const universityId = librarianLibrary(actor)
    const settings = await this.settings.requireEnabled(universityId)
    const readerId = readTicket(this.config, input.ticket, actor.sub, universityId)
    const reader = await this.readerOf(universityId, readerId)
    const eligibility = await this.eligibility(reader, settings.maxActiveLoans)
    const blocker = eligibility.blockers[0]
    if (blocker) throw this.blockerConflict(blocker)

    const timezone = await this.timezoneOf(universityId)
    const today = todayIn(timezone)
    const dueDate = input.dueDate ?? addDays(today, settings.defaultLoanDays)
    const span = daysBetween(today, dueDate)
    if (span < 0 || span > settings.maxLoanDays) {
      throw new AppException('VALIDATION_ERROR', 'Срок выдачи вне правил библиотеки', [
        { field: 'dueDate', message: `От сегодня до ${settings.maxLoanDays} дней` },
      ])
    }

    const copy = await this.findCopy(universityId, input)
    if (copy.book.archivedAt) throw libraryConflict('archived', 'Книга в архиве')
    let reservationId: string | null = null
    if (copy.status === 'RESERVED') {
      // Отложенный под бронь экземпляр выдаётся только тому, чья это бронь.
      const reservation = await this.prisma.reservation.findFirst({
        where: { copyId: copy.id, status: 'READY' },
        select: { id: true, readerId: true },
      })
      if (!reservation || reservation.readerId !== reader.id) {
        throw libraryConflict('reserved', 'Экземпляр отложен под бронь другого читателя')
      }
      reservationId = reservation.id
    } else if (copy.status === 'ON_LOAN') {
      throw libraryConflict('onLoan', 'Экземпляр уже выдан — сначала оформите возврат')
    } else if (copy.status !== 'AVAILABLE') {
      throw libraryConflict('withdrawn', 'Экземпляр выведен из оборота')
    }

    const loan = await this.prisma.$transaction(async (tx) => {
      // Условная запись: экземпляр забирает только одна выдача, даже при двух одновременных.
      const { count } = await tx.bookCopy.updateMany({
        where: { id: copy.id, status: copy.status },
        data: { status: 'ON_LOAN' },
      })
      if (count === 0) throw libraryConflict('onLoan', 'Экземпляр только что выдали')
      const created = await tx.loan.create({
        data: {
          universityId,
          copyId: copy.id,
          readerId: reader.id,
          issuedById: actor.sub,
          dueAt: endOfDay(dueDate, timezone),
          readerName: fullName(reader),
          readerGroup: reader.group?.name ?? null,
          readerCard: reader.studentCardNumber,
          bookTitle: copy.book.title,
          inventoryNumber: copy.inventoryNumber,
        },
        select: LOAN_SELECT,
      })
      if (reservationId) {
        await tx.reservation.update({
          where: { id: reservationId },
          data: { status: 'FULFILLED', loanId: created.id, closedAt: new Date() },
        })
      }
      return created
    })

    await this.audit.record({
      userId: actor.sub,
      action: 'library_loan_issued',
      entity: 'Loan',
      entityId: loan.id,
      metadata: {
        universityId,
        readerId: reader.id,
        copyId: copy.id,
        dueDate,
        ...(reservationId ? { reservationId } : {}),
      },
      ...ctx,
    })
    await this.notifier.send({
      recipientIds: [reader.id],
      job: NOTIFICATION_JOBS.LIBRARY_LOAN,
      titleKey: 'library.loanIssued.title',
      bodyKey: 'library.loanIssued.body',
      params: { title: copy.book.title, number: copy.inventoryNumber, date: formatDay(dueDate) },
      url: '/my-books',
      dedupeKey: `library-loan-issued:${loan.id}`,
    })
    const [item] = await this.toItems([loan], timezone)
    if (!item) throw new AppException('INTERNAL_ERROR', 'Выдача не найдена')
    return item
  }

  // ── «Это не я» ───────────────────────────────────────────────────────────────────

  /**
   * Читатель отмечает выдачу как ошибочную: книгу записали на него, а он её не брал. Выдача
   * остаётся как есть — решает библиотекарь (отменить или оставить), — но все библиотекари
   * вуза получают уведомление, а отметка видна в списке выдач и журнале.
   */
  async dispute(actor: JwtPayload, loanId: string, ctx: RequestContext): Promise<LoanItem> {
    const universityId = readerLibrary(actor)
    const loan = await this.prisma.loan.findUnique({ where: { id: loanId }, select: LOAN_SELECT })
    if (!loan || loan.readerId !== actor.sub || loan.universityId !== universityId) {
      throw new AppException('NOT_FOUND', 'Выдача не найдена')
    }
    if (loan.status !== 'OPEN') throw libraryConflict('status', 'Выдача уже закрыта')
    const timezone = await this.timezoneOf(universityId)
    if (loan.disputedAt) {
      const [item] = await this.toItems([loan], timezone)
      if (!item) throw new AppException('INTERNAL_ERROR', 'Выдача не найдена')
      return item
    }
    const updated = await this.prisma.loan.update({
      where: { id: loanId },
      data: { disputedAt: new Date() },
      select: LOAN_SELECT,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'library_loan_disputed',
      entity: 'Loan',
      entityId: loanId,
      metadata: { universityId, copyId: loan.copyId },
      ...ctx,
    })
    const librarians = await this.prisma.user.findMany({
      where: { universityId, role: Role.LIBRARIAN, deletedAt: null, isBlocked: false },
      select: { id: true },
      take: 50,
    })
    await this.notifier.send({
      recipientIds: librarians.map((l) => l.id),
      job: NOTIFICATION_JOBS.LIBRARY_LOAN,
      titleKey: 'library.loanDisputed.title',
      bodyKey: 'library.loanDisputed.body',
      params: { name: loan.readerName, title: loan.bookTitle, number: loan.inventoryNumber },
      url: '/library/loans',
      dedupeKey: `library-loan-disputed:${loanId}`,
    })
    const [item] = await this.toItems([updated], timezone)
    if (!item) throw new AppException('INTERNAL_ERROR', 'Выдача не найдена')
    return item
  }

  // ── Списки ───────────────────────────────────────────────────────────────────────

  /** Выдачи вуза — тем, кто ведёт фонд: на руках, просроченные, закрытые. */
  async list(actor: JwtPayload, query: LoanListQueryInput): Promise<Paginated<LoanItem>> {
    const universityId = staffLibrary(actor)
    const now = new Date()
    const where: Prisma.LoanWhereInput = {
      universityId,
      ...(query.filter === 'open' ? { status: 'OPEN' } : {}),
      ...(query.filter === 'overdue' ? { status: 'OPEN', dueAt: { lt: now } } : {}),
      ...(query.filter === 'closed' ? { status: { in: ['RETURNED', 'LOST', 'CANCELLED'] } } : {}),
      ...(query.readerId ? { readerId: query.readerId } : {}),
      ...(query.copyId ? { copyId: query.copyId } : {}),
      ...(query.q
        ? {
            OR: [
              { readerName: { contains: query.q, mode: 'insensitive' } },
              { bookTitle: { contains: query.q, mode: 'insensitive' } },
              { inventoryNumber: { contains: query.q } },
              { readerCard: { contains: query.q } },
            ],
          }
        : {}),
    }
    const orderBy: Prisma.LoanOrderByWithRelationInput[] =
      query.filter === 'open' || query.filter === 'overdue'
        ? [{ dueAt: 'asc' }, { id: 'asc' }]
        : [{ issuedAt: 'desc' }, { id: 'asc' }]
    const { page, limit } = query
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.loan.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: LOAN_SELECT,
      }),
      this.prisma.loan.count({ where }),
    ])
    return new Paginated(await this.toItems(rows, await this.timezoneOf(universityId)), { total })
  }

  /** Мои книги — у читателя: сначала на руках (по сроку), затем история. */
  async mine(actor: JwtPayload): Promise<LoanItem[]> {
    const universityId = readerLibrary(actor)
    const rows = await this.prisma.loan.findMany({
      where: { readerId: actor.sub, universityId, status: { not: 'CANCELLED' } },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { issuedAt: 'desc' }],
      take: 100,
      select: LOAN_SELECT,
    })
    return this.toItems(rows, await this.timezoneOf(universityId))
  }

  // ── Внутреннее ───────────────────────────────────────────────────────────────────

  /** Может ли читатель брать книги и почему нет. */
  async eligibility(
    reader: { id: string; academicStatus: string | null },
    maxActiveLoans: number,
  ): Promise<ReaderEligibility> {
    const now = new Date()
    const [activeLoans, overdueLoans] = await Promise.all([
      this.prisma.loan.count({ where: { readerId: reader.id, status: 'OPEN' } }),
      this.prisma.loan.count({
        where: { readerId: reader.id, status: 'OPEN', dueAt: { lt: now } },
      }),
    ])
    const blockers: ReaderBlocker[] = []
    if (isBlockedStatus(reader.academicStatus)) blockers.push('status')
    if (overdueLoans > 0) blockers.push('overdue')
    if (activeLoans >= maxActiveLoans) blockers.push('limit')
    return { canBorrow: blockers.length === 0, activeLoans, maxActiveLoans, overdueLoans, blockers }
  }

  blockerConflict(blocker: ReaderBlocker): AppException {
    switch (blocker) {
      case 'status':
        return libraryConflict('status', 'Студент отчислен, выпущен или переведён')
      case 'overdue':
        return libraryConflict('overdue', 'У читателя просрочена книга — сначала её возврат')
      case 'limit':
        return libraryConflict('limit', 'У читателя на руках предельное число книг')
    }
  }

  /** Читатель вуза: студент или староста, не удалён и не заблокирован. */
  async readerOf(universityId: string, userId: string): Promise<ReaderRow> {
    const reader = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isBlocked: false },
      select: READER_SELECT,
    })
    if (!reader || reader.universityId !== universityId) {
      throw new AppException('NOT_FOUND', 'Читатель не найден')
    }
    if (!READER_ROLES.includes(reader.role)) {
      throw libraryConflict('reader', 'Книги выдаются студентам и старостам')
    }
    return reader
  }

  /** Экземпляр своего вуза по коду наклейки или инвентарному номеру. */
  async findCopy(
    universityId: string,
    ref: { copyCode?: string; inventoryNumber?: string },
  ): Promise<{
    id: string
    status: BookCopyStatus
    inventoryNumber: string
    book: { id: string; title: string; archivedAt: Date | null }
  }> {
    const select = {
      id: true,
      universityId: true,
      status: true,
      inventoryNumber: true,
      book: { select: { id: true, title: true, archivedAt: true } },
    } satisfies Prisma.BookCopySelect
    const copy = ref.copyCode
      ? await this.prisma.bookCopy.findUnique({
          where: { code: ref.copyCode.replace(/-/g, '').toUpperCase() },
          select,
        })
      : await this.prisma.bookCopy.findUnique({
          where: {
            universityId_inventoryNumber: {
              universityId,
              inventoryNumber: ref.inventoryNumber ?? '',
            },
          },
          select,
        })
    if (!copy || copy.universityId !== universityId) {
      throw new AppException('NOT_FOUND', 'Экземпляр не найден')
    }
    return copy
  }

  async timezoneOf(universityId: string): Promise<string> {
    const university = await this.prisma.university.findUnique({
      where: { id: universityId },
      select: { timezone: true },
    })
    return university?.timezone || 'Asia/Almaty'
  }

  /** Строки выдач → ответ: срок датой по часам вуза, обложки — одним запросом. */
  async toItems(rows: LoanRow[], timezone: string): Promise<LoanItem[]> {
    const covers = await this.files.getPresignedUrls(
      rows.map((r) => r.copy.book.coverFileId).filter((id): id is string => Boolean(id)),
    )
    const now = new Date()
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      issuedAt: r.issuedAt.toISOString(),
      dueAt: r.dueAt.toISOString(),
      dueDate: todayIn(timezone, r.dueAt),
      overdue: r.status === 'OPEN' && r.dueAt < now,
      renewals: r.renewals,
      returnedAt: r.returnedAt?.toISOString() ?? null,
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      cancelReason: r.cancelReason,
      disputedAt: r.disputedAt?.toISOString() ?? null,
      book: {
        id: r.copy.book.id,
        title: r.copy.book.title,
        authors: r.copy.book.authors,
        coverUrl: r.copy.book.coverFileId ? (covers.get(r.copy.book.coverFileId) ?? null) : null,
      },
      copy: { id: r.copyId, inventoryNumber: r.inventoryNumber },
      reader: { id: r.readerId, name: r.readerName, group: r.readerGroup, card: r.readerCard },
      issuedBy: r.issuedBy ? fullName(r.issuedBy) : null,
    }))
  }
}
