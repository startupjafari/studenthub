import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { CreateSpecialtyInput, UpdateSpecialtyInput } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { advisoryXactLock } from '../../common/prisma/advisory-lock'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { UserService } from '../users/users.service'
import { findSpecialtyByName } from './specialty-name'

const SPECIALTY_SELECT = { id: true, name: true } satisfies Prisma.SpecialtySelect

/**
 * Потолок выборки справочника специальностей вуза. Столько их не бывает даже у крупного
 * университета — ограничение страхует от промаха в фильтре, а не режет реальные данные
 * (`findMany` без `take` запрещён, BACKEND_RULES §5.3/§18.8).
 */
const SPECIALTY_LIST_LIMIT = 500

@Injectable()
export class SpecialtiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly users: UserService,
  ) {}

  /** Специальности вуза зрителя (для Select в профиле и админ-экрана). Без вуза — пусто. */
  async list(viewer: JwtPayload) {
    if (!viewer.universityId) return []
    return this.prisma.specialty.findMany({
      where: { universityId: viewer.universityId },
      orderBy: { name: 'asc' },
      select: SPECIALTY_SELECT,
      take: SPECIALTY_LIST_LIMIT,
    })
  }

  /** Создание — только UNIVERSITY_ADMIN, в свой вуз (universityId из JWT, не из body). */
  async create(actor: JwtPayload, input: CreateSpecialtyInput, ctx: RequestContext) {
    if (!actor.universityId) {
      throw new AppException('WRONG_SCOPE', 'Пользователь не привязан к вузу')
    }
    const universityId = actor.universityId
    const name = input.name.trim()
    try {
      const specialty = await this.prisma.$transaction(async (tx) => {
        await this.assertNameFree(tx, universityId, name)
        return tx.specialty.create({
          data: { name, universityId },
          select: SPECIALTY_SELECT,
        })
      })
      await this.audit.record({
        userId: actor.sub,
        action: 'specialty_created',
        entity: 'Specialty',
        entityId: specialty.id,
        metadata: { universityId: actor.universityId },
        ...ctx,
      })
      return specialty
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException('CONFLICT', 'Такая специальность уже есть')
      }
      throw error
    }
  }

  /**
   * Переименование (опечатка, смена названия по приказу).
   *
   * В профиле студента специальность — строка-название, а не ссылка на справочник (связи
   * в схеме нет). Поэтому той же транзакцией переименовываются и учебные данные студентов
   * вуза с прежним названием (`UserService.renameSpecialty`): иначе в справках и
   * студенческих оставалось старое.
   */
  async update(actor: JwtPayload, id: string, input: UpdateSpecialtyInput, ctx: RequestContext) {
    const current = await this.findOwned(actor, id)
    const name = input.name.trim()
    try {
      const { specialty, renamedProfiles } = await this.prisma.$transaction(async (tx) => {
        await this.assertNameFree(tx, current.universityId, name, id)
        const row = await tx.specialty.update({
          where: { id },
          data: { name },
          select: SPECIALTY_SELECT,
        })
        const renamed =
          row.name === current.name
            ? 0
            : await this.users.renameSpecialty(tx, current.universityId, current.name, row.name)
        return { specialty: row, renamedProfiles: renamed }
      })
      await this.audit.record({
        userId: actor.sub,
        action: 'specialty_updated',
        entity: 'Specialty',
        entityId: id,
        metadata: { from: current.name, to: specialty.name, renamedProfiles },
        ...ctx,
      })
      return specialty
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException('CONFLICT', 'Такая специальность уже есть')
      }
      throw error
    }
  }

  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    await this.findOwned(actor, id)
    await this.prisma.specialty.delete({ where: { id } })
    await this.audit.record({
      userId: actor.sub,
      action: 'specialty_deleted',
      entity: 'Specialty',
      entityId: id,
      ...ctx,
    })
  }

  /**
   * Название свободно в справочнике вуза — без учёта регистра. Уникальный индекс
   * `(universityId, name)` регистр различает и «информатика» рядом с «Информатика» пропускал:
   * выбор в учебных данных потом не знал бы, какая из двух. Под advisory-локом на вуз — два
   * параллельных создания идут по очереди.
   */
  private async assertNameFree(
    tx: Prisma.TransactionClient,
    universityId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    await advisoryXactLock(tx, `specialty-name:${universityId}`)
    if (await findSpecialtyByName(tx, universityId, name, exceptId)) {
      throw new AppException('CONFLICT', 'Такая специальность уже есть')
    }
  }

  /** Специальность своего вуза — иначе NOT_FOUND / WRONG_SCOPE (IDOR, BACKEND_RULES §14.10). */
  private async findOwned(
    actor: JwtPayload,
    id: string,
  ): Promise<{ id: string; name: string; universityId: string }> {
    const specialty = await this.prisma.specialty.findUnique({
      where: { id },
      select: { id: true, name: true, universityId: true },
    })
    if (!specialty) {
      throw new AppException('NOT_FOUND', 'Специальность не найдена')
    }
    if (specialty.universityId !== actor.universityId) {
      throw new AppException('WRONG_SCOPE', 'Ресурс другого университета')
    }
    return specialty
  }
}
