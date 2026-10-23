import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type {
  CreateVisitorInput,
  VisitorItem,
  VisitorListQueryInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { journalUniversity, recorderUniversity } from './security-scope'
import { dayRange, universityTimezone } from './journal-day'

const VISITOR_SELECT = {
  id: true,
  fullName: true,
  purpose: true,
  documentType: true,
  documentLast4: true,
  phone: true,
  enteredAt: true,
  exitedAt: true,
  createdByName: true,
} satisfies Prisma.SecurityVisitorSelect

type VisitorRow = Prisma.SecurityVisitorGetPayload<{ select: typeof VISITOR_SELECT }>

function toItem(row: VisitorRow): VisitorItem {
  return {
    ...row,
    enteredAt: row.enteredAt.toISOString(),
    exitedAt: row.exitedAt?.toISOString() ?? null,
  }
}

/**
 * Журнал посетителей поста охраны (docs/PROJECT.md §3.12): гость, родитель, курьер. Запись
 * не правится и не удаляется — это журнал; уходит сама через год (`purgeViewLogs`).
 */
@Injectable()
export class SecurityVisitorsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(actor: JwtPayload, input: CreateVisitorInput): Promise<VisitorItem> {
    const universityId = recorderUniversity(actor)
    const guard = await this.prisma.user.findUnique({
      where: { id: actor.sub },
      select: { firstName: true, lastName: true },
    })
    const row = await this.prisma.securityVisitor.create({
      data: {
        universityId,
        fullName: input.fullName,
        purpose: input.purpose,
        documentType: input.documentType ?? null,
        documentLast4: input.documentLast4 ?? null,
        phone: input.phone ?? null,
        createdById: actor.sub,
        createdByName: guard ? `${guard.lastName} ${guard.firstName}` : actor.sub,
      },
      select: VISITOR_SELECT,
    })
    return toItem(row)
  }

  /** Выход посетителя. Отметить дважды нельзя: второе нажатие — `409 exited`. */
  async exit(actor: JwtPayload, id: string): Promise<VisitorItem> {
    const universityId = recorderUniversity(actor)
    const { count } = await this.prisma.securityVisitor.updateMany({
      where: { id, universityId, exitedAt: null },
      data: { exitedAt: new Date(), exitedById: actor.sub },
    })
    const row = await this.prisma.securityVisitor.findFirst({
      where: { id, universityId },
      select: VISITOR_SELECT,
    })
    // Чужой вуз и неизвестный id — одинаковый 404 (BACKEND_RULES §14.10).
    if (!row) throw new AppException('NOT_FOUND', 'Запись не найдена')
    if (count === 0) {
      throw new AppException('CONFLICT', 'Выход уже отмечен', [
        { field: 'exited', message: 'Выход уже отмечен' },
      ])
    }
    return toItem(row)
  }

  async list(actor: JwtPayload, query: VisitorListQueryInput): Promise<Paginated<VisitorItem>> {
    const universityId = journalUniversity(actor)
    const where: Prisma.SecurityVisitorWhereInput = {
      universityId,
      ...(query.status === 'inside' ? { exitedAt: null } : {}),
      ...(query.date
        ? { enteredAt: dayRange(query.date, await universityTimezone(this.prisma, universityId)) }
        : {}),
      ...(query.q
        ? {
            OR: [
              { fullName: { contains: query.q, mode: 'insensitive' } },
              { purpose: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.securityVisitor.findMany({
        where,
        orderBy: [{ enteredAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: VISITOR_SELECT,
      }),
      this.prisma.securityVisitor.count({ where }),
    ])
    return new Paginated(rows.map(toItem), { total })
  }
}
