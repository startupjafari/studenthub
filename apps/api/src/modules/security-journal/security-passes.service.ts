import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type {
  PassDenyReasonValue,
  PassItem,
  PassListQueryInput,
  SecuritySummary,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { journalUniversity } from './security-scope'
import { dayRange, todayIn, universityTimezone } from './journal-day'

/** Что записать о проходе. Студент — только если он известен и из этого же вуза. */
export interface PassRecord {
  guard: JwtPayload
  student: { id: string; name: string; group: string | null } | null
  allowed: boolean
  denyReason: PassDenyReasonValue | null
}

const PASS_SELECT = {
  id: true,
  createdAt: true,
  allowed: true,
  denyReason: true,
  studentId: true,
  studentName: true,
  studentGroup: true,
  guardName: true,
} satisfies Prisma.SecurityPassSelect

type PassRow = Prisma.SecurityPassGetPayload<{ select: typeof PASS_SELECT }>

function toItem(row: PassRow): PassItem {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    allowed: row.allowed,
    denyReason: row.denyReason,
    student: row.studentName
      ? { id: row.studentId, name: row.studentName, group: row.studentGroup }
      : null,
    guardName: row.guardName,
  }
}

/**
 * Журнал проходов студентов (docs/PROJECT.md §3.12). Пишет его проверка студенческого
 * охраной (`StudentIdService.verify`); здесь — запись, журнал и сводка поста за день.
 */
@Injectable()
export class SecurityPassesService {
  private readonly logger = new Logger(SecurityPassesService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Запись прохода. Сбой журнала проход не останавливает: охраннику на входе важнее увидеть
   * результат проверки, чем узнать, что строка не записалась, — сбой уходит в лог.
   */
  async record(input: PassRecord): Promise<void> {
    const universityId = input.guard.universityId
    if (!universityId) return
    try {
      const guard = await this.prisma.user.findUnique({
        where: { id: input.guard.sub },
        select: { firstName: true, lastName: true },
      })
      await this.prisma.securityPass.create({
        data: {
          universityId,
          guardId: input.guard.sub,
          guardName: guard ? `${guard.lastName} ${guard.firstName}` : input.guard.sub,
          studentId: input.student?.id ?? null,
          studentName: input.student?.name ?? null,
          studentGroup: input.student?.group ?? null,
          allowed: input.allowed,
          denyReason: input.denyReason,
        },
      })
    } catch (error) {
      this.logger.error(
        { err: error, guardId: input.guard.sub, universityId },
        'Проход не записан в журнал',
      )
    }
  }

  async list(actor: JwtPayload, query: PassListQueryInput): Promise<Paginated<PassItem>> {
    const universityId = journalUniversity(actor)
    const where: Prisma.SecurityPassWhereInput = {
      universityId,
      ...(query.allowed === undefined ? {} : { allowed: query.allowed }),
      ...(query.date
        ? { createdAt: dayRange(query.date, await universityTimezone(this.prisma, universityId)) }
        : {}),
      ...(query.q
        ? {
            OR: [
              { studentName: { contains: query.q, mode: 'insensitive' } },
              { studentGroup: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.securityPass.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: PASS_SELECT,
      }),
      this.prisma.securityPass.count({ where }),
    ])
    return new Paginated(rows.map(toItem), { total })
  }

  /** Сводка поста за сегодня по часам вуза: проходы и посетители. */
  async summary(actor: JwtPayload): Promise<SecuritySummary> {
    const universityId = journalUniversity(actor)
    const timezone = await universityTimezone(this.prisma, universityId)
    const date = todayIn(timezone)
    const today = dayRange(date, timezone)
    const [total, allowed, visitorsToday, inside] = await this.prisma.$transaction([
      this.prisma.securityPass.count({ where: { universityId, createdAt: today } }),
      this.prisma.securityPass.count({ where: { universityId, createdAt: today, allowed: true } }),
      this.prisma.securityVisitor.count({ where: { universityId, enteredAt: today } }),
      this.prisma.securityVisitor.count({ where: { universityId, exitedAt: null } }),
    ])
    return {
      date,
      passes: { total, allowed, denied: total - allowed },
      visitors: { today: visitorsToday, inside },
    }
  }
}
