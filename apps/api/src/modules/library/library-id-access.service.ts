import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type { IdAccessItem, IdAccessQueryInput, LoanReaderCard } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { LibraryLoansService, toReader } from './library-loans.service'
import { todayIn } from './library-dates'
import { librarianLibrary, staffLibrary } from './library-scope'

// Удостоверение читателя на время выдачи (Фаза 20.6, docs/PROJECT.md §3.11). Пока книга на
// руках, библиотекарь может открыть карточку читателя — сверить, у кого она, и связаться.
// Набор полей узкий, как у охраны; каждый просмотр — строка журнала (кто, чьё, по какой
// выдаче, IP). Выдача закрыта — карточка закрыта: `403`, а не «последняя известная».

const READER_CARD_SELECT = {
  id: true,
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

@Injectable()
export class LibraryIdAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loans: LibraryLoansService,
  ) {}

  async readerCard(
    actor: JwtPayload,
    loanId: string,
    ctx: RequestContext,
  ): Promise<LoanReaderCard> {
    const universityId = librarianLibrary(actor)
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      select: {
        id: true,
        universityId: true,
        status: true,
        readerId: true,
        readerName: true,
        bookTitle: true,
        inventoryNumber: true,
        issuedAt: true,
        dueAt: true,
      },
    })
    if (!loan || loan.universityId !== universityId) {
      throw new AppException('NOT_FOUND', 'Выдача не найдена')
    }
    if (loan.status !== 'OPEN') {
      throw new AppException('FORBIDDEN', 'Книга возвращена — удостоверение больше не доступно')
    }
    const reader = loan.readerId
      ? await this.prisma.user.findFirst({
          where: { id: loan.readerId, universityId, deletedAt: null },
          select: READER_CARD_SELECT,
        })
      : null
    if (!reader) throw new AppException('NOT_FOUND', 'Читатель удалён')
    const librarian = await this.prisma.user.findUnique({
      where: { id: actor.sub },
      select: { firstName: true, lastName: true },
    })
    const viewed = await this.prisma.libraryIdAccessLog.create({
      data: {
        universityId,
        loanId: loan.id,
        librarianId: actor.sub,
        librarianName: librarian ? `${librarian.lastName} ${librarian.firstName}` : '—',
        readerId: reader.id,
        readerName: loan.readerName,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent?.slice(0, 500) ?? null,
      },
      select: { createdAt: true },
    })
    const timezone = await this.loans.timezoneOf(universityId)
    return {
      reader: toReader(reader),
      loan: {
        id: loan.id,
        bookTitle: loan.bookTitle,
        inventoryNumber: loan.inventoryNumber,
        issuedAt: loan.issuedAt.toISOString(),
        dueDate: todayIn(timezone, loan.dueAt),
      },
      viewedAt: viewed.createdAt.toISOString(),
    }
  }

  /** Журнал просмотров — библиотекарю и админу вуза, новые сверху. */
  async journal(actor: JwtPayload, query: IdAccessQueryInput): Promise<Paginated<IdAccessItem>> {
    const universityId = staffLibrary(actor)
    const where: Prisma.LibraryIdAccessLogWhereInput = {
      universityId,
      ...(query.readerId ? { readerId: query.readerId } : {}),
      ...(query.loanId ? { loanId: query.loanId } : {}),
      ...(query.q
        ? {
            OR: [
              { readerName: { contains: query.q, mode: 'insensitive' } },
              { librarianName: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    }
    const { page, limit } = query
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.libraryIdAccessLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          createdAt: true,
          librarianName: true,
          readerId: true,
          readerName: true,
          loanId: true,
          ip: true,
          loan: { select: { bookTitle: true } },
        },
      }),
      this.prisma.libraryIdAccessLog.count({ where }),
    ])
    return new Paginated(
      rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        librarianName: r.librarianName,
        readerId: r.readerId,
        readerName: r.readerName,
        loanId: r.loanId,
        bookTitle: r.loan?.bookTitle ?? null,
        ip: r.ip,
      })),
      { total },
    )
  }
}
