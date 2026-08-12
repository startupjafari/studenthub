import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { CreatePortfolioItemInput, UpdatePortfolioItemInput } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'

const ITEM_SELECT = {
  id: true,
  kind: true,
  title: true,
  organization: true,
  description: true,
  url: true,
  startDate: true,
  endDate: true,
  visibility: true,
  order: true,
  createdAt: true,
} satisfies Prisma.PortfolioItemSelect

// Сортировка: сначала явный order, затем по дате начала (свежие выше), затем по создании.
const ITEM_ORDER: Prisma.PortfolioItemOrderByWithRelationInput[] = [
  { order: 'asc' },
  { startDate: 'desc' },
  { createdAt: 'desc' },
]

@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Моё портфолио (владелец видит все записи, включая приватные). */
  listMine(viewer: JwtPayload) {
    return this.prisma.portfolioItem.findMany({
      where: { userId: viewer.sub },
      select: ITEM_SELECT,
      orderBy: ITEM_ORDER,
      take: 500,
    })
  }

  /** Портфолио пользователя глазами зрителя: приватные скрыты, UNIVERSITY — только внутри вуза. */
  async listForUser(viewer: JwtPayload, userId: string) {
    if (userId === viewer.sub) return this.listMine(viewer)
    const owner = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { universityId: true },
    })
    if (!owner) throw new AppException('NOT_FOUND', 'Пользователь не найден')
    const sameUniversity = owner.universityId != null && owner.universityId === viewer.universityId
    const visibilities = sameUniversity ? ['PUBLIC', 'UNIVERSITY'] : ['PUBLIC']
    return this.prisma.portfolioItem.findMany({
      where: { userId, visibility: { in: visibilities } },
      select: ITEM_SELECT,
      orderBy: ITEM_ORDER,
      take: 500,
    })
  }

  async create(actor: JwtPayload, input: CreatePortfolioItemInput, ctx: RequestContext) {
    const item = await this.prisma.portfolioItem.create({
      data: {
        userId: actor.sub,
        kind: input.kind,
        title: input.title,
        organization: input.organization,
        description: input.description,
        url: input.url,
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        visibility: input.visibility ?? 'UNIVERSITY',
      },
      select: ITEM_SELECT,
    })
    await this.record(actor, 'portfolio_item_created', item.id, ctx)
    return item
  }

  async update(
    actor: JwtPayload,
    id: string,
    input: UpdatePortfolioItemInput,
    ctx: RequestContext,
  ) {
    await this.assertOwner(actor, id)
    const item = await this.prisma.portfolioItem.update({
      where: { id },
      data: {
        kind: input.kind,
        title: input.title,
        organization: input.organization,
        description: input.description,
        url: input.url,
        startDate:
          input.startDate === undefined
            ? undefined
            : input.startDate
              ? new Date(input.startDate)
              : null,
        endDate:
          input.endDate === undefined ? undefined : input.endDate ? new Date(input.endDate) : null,
        visibility: input.visibility,
      },
      select: ITEM_SELECT,
    })
    await this.record(actor, 'portfolio_item_updated', id, ctx)
    return item
  }

  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    await this.assertOwner(actor, id)
    await this.prisma.portfolioItem.delete({ where: { id } })
    await this.record(actor, 'portfolio_item_deleted', id, ctx)
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async assertOwner(actor: JwtPayload, id: string): Promise<void> {
    const item = await this.prisma.portfolioItem.findUnique({
      where: { id },
      select: { userId: true },
    })
    if (!item) throw new AppException('NOT_FOUND', 'Запись портфолио не найдена')
    if (item.userId !== actor.sub) throw new AppException('FORBIDDEN', 'Не ваша запись')
  }

  private async record(
    actor: JwtPayload,
    action: string,
    entityId: string,
    ctx: RequestContext,
  ): Promise<void> {
    await this.audit.record({
      userId: actor.sub,
      action,
      entity: 'PortfolioItem',
      entityId,
      ...ctx,
    })
  }
}
