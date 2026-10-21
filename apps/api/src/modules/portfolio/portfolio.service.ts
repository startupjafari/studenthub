import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  PORTFOLIO_MAX_ITEMS,
  type CreatePortfolioItemInput,
  type PortfolioVisibility,
  type ReorderPortfolioInput,
  type UpdatePortfolioItemInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { advisoryXactLock } from '../../common/prisma/advisory-lock'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { PROFILE_CONTENT_OWNER_SELECT, UserService } from '../users/users.service'

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
// Экспортируется для карьерного модуля: резюме и карточка кандидата режут портфолио по take,
// и без полной сортировки в срез попадали бы произвольные записи (order у всех одинаковый).
export const PORTFOLIO_ITEM_ORDER: Prisma.PortfolioItemOrderByWithRelationInput[] = [
  { order: 'asc' },
  { startDate: 'desc' },
  { createdAt: 'desc' },
]

/**
 * Кто смотрит на портфолио — от этого зависит, какие записи ему видны:
 * - `owner` — сам владелец: всё, включая PRIVATE;
 * - `university` — пользователь того же вуза: PUBLIC и UNIVERSITY;
 * - `external` — все остальные: только PUBLIC. Сюда же аноним по публичной ссылке на резюме
 *   и работодатель — компания по определению вне вуза, UNIVERSITY ей не положено.
 */
export type PortfolioAudience = 'owner' | 'university' | 'external'

const AUDIENCE_VISIBILITIES: Record<Exclude<PortfolioAudience, 'owner'>, PortfolioVisibility[]> = {
  university: ['PUBLIC', 'UNIVERSITY'],
  external: ['PUBLIC'],
}

/**
 * Условие выборки записей портфолио, видимых аудитории. ЕДИНСТВЕННОЕ место правила
 * видимости: его зовут и этот сервис, и карьерный модуль (резюме, карточка кандидата),
 * чтобы флаг приватности записи не игнорировался молча там, где про него забыли.
 */
export function portfolioVisibilityWhere(
  audience: PortfolioAudience,
): Prisma.PortfolioItemWhereInput {
  return audience === 'owner' ? {} : { visibility: { in: AUDIENCE_VISIBILITIES[audience] } }
}

// Выдача списка. Больше PORTFOLIO_MAX_ITEMS записей не создать, но у тех, кто успел до потолка,
// хвост не обрезаем: запас покрывает их, а findMany без take запрещён (§5.3).
const LIST_TAKE = 500

@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly users: UserService,
  ) {}

  /** Моё портфолио (владелец видит все записи, включая приватные). */
  listMine(viewer: JwtPayload) {
    return this.prisma.portfolioItem.findMany({
      where: { userId: viewer.sub },
      select: ITEM_SELECT,
      orderBy: PORTFOLIO_ITEM_ORDER,
      // Потолок записей — PORTFOLIO_MAX_ITEMS, но записи, созданные до него, не прячем.
      take: LIST_TAKE,
    })
  }

  /**
   * Портфолио пользователя глазами зрителя: приватные скрыты, UNIVERSITY — только внутри вуза.
   * Портфолио — такой же контент профиля, как фото и статьи: удалённый аккаунт не виден
   * никому («не найден», как несуществующий), а закрытый профиль прячет и портфолио —
   * по тому же правилу, что решает, отдать полную карточку или «визитку».
   */
  async listForUser(viewer: JwtPayload, userId: string) {
    if (userId === viewer.sub) return this.listMine(viewer)
    const owner = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PROFILE_CONTENT_OWNER_SELECT,
    })
    if (!owner || owner.deletedAt) throw new AppException('NOT_FOUND', 'Пользователь не найден')
    if (!(await this.users.canViewProfileContentOf(viewer, owner))) return []
    const sameUniversity = owner.universityId != null && owner.universityId === viewer.universityId
    return this.prisma.portfolioItem.findMany({
      where: { userId, ...portfolioVisibilityWhere(sameUniversity ? 'university' : 'external') },
      select: ITEM_SELECT,
      orderBy: PORTFOLIO_ITEM_ORDER,
      take: LIST_TAKE,
    })
  }

  async create(actor: JwtPayload, input: CreatePortfolioItemInput, ctx: RequestContext) {
    // Подсчёт и вставка — под локом владельца: два параллельных запроса на последнем месте
    // иначе оба увидели бы «ещё есть место» и вместе перешли бы потолок.
    const item = await this.prisma.$transaction(async (tx) => {
      await advisoryXactLock(tx, `portfolio:${actor.sub}`)
      const count = await tx.portfolioItem.count({ where: { userId: actor.sub } })
      if (count >= PORTFOLIO_MAX_ITEMS) {
        throw new AppException(
          'BAD_REQUEST',
          `В портфолио может быть не больше ${PORTFOLIO_MAX_ITEMS} записей`,
        )
      }
      return tx.portfolioItem.create({
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
    })
    await this.record(actor, 'portfolio_item_created', item.id, ctx)
    return item
  }

  /**
   * Порядок записей: перечисленные встают первыми в присланном порядке, остальные — следом,
   * сохраняя свой прежний порядок. `order` проставляется всем записям подряд (0, 1, 2…), иначе
   * при одинаковом `order` порядок решала бы дата начала, а не пользователь. Чужой или
   * несуществующий id — BAD_REQUEST: переставлять можно только свои записи.
   */
  async reorder(actor: JwtPayload, input: ReorderPortfolioInput) {
    await this.prisma.$transaction(async (tx) => {
      // Тот же лок, что у создания: запись, добавленная посреди перестановки, не потеряет место.
      await advisoryXactLock(tx, `portfolio:${actor.sub}`)
      const current = await tx.portfolioItem.findMany({
        where: { userId: actor.sub },
        select: { id: true, order: true },
        orderBy: PORTFOLIO_ITEM_ORDER,
        take: LIST_TAKE,
      })
      const own = new Set(current.map((item) => item.id))
      if (!input.ids.every((id) => own.has(id))) {
        throw new AppException('BAD_REQUEST', 'Переставлять можно только свои записи портфолио')
      }
      const listed = new Set(input.ids)
      const next = [...input.ids, ...current.filter((i) => !listed.has(i.id)).map((i) => i.id)]
      const before = new Map(current.map((item) => [item.id, item.order]))
      for (const [order, id] of next.entries()) {
        if (before.get(id) === order) continue
        await tx.portfolioItem.update({ where: { id }, data: { order }, select: { id: true } })
      }
    })
    return this.listMine(actor)
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
