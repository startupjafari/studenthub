import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { CreateSpecialtyInput } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'

const SPECIALTY_SELECT = { id: true, name: true } satisfies Prisma.SpecialtySelect

@Injectable()
export class SpecialtiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Специальности вуза зрителя (для Select в профиле и админ-экрана). Без вуза — пусто. */
  async list(viewer: JwtPayload) {
    if (!viewer.universityId) return []
    return this.prisma.specialty.findMany({
      where: { universityId: viewer.universityId },
      orderBy: { name: 'asc' },
      select: SPECIALTY_SELECT,
    })
  }

  /** Создание — только UNIVERSITY_ADMIN, в свой вуз (universityId из JWT, не из body). */
  async create(actor: JwtPayload, input: CreateSpecialtyInput, ctx: RequestContext) {
    if (!actor.universityId) {
      throw new AppException('WRONG_SCOPE', 'Пользователь не привязан к вузу')
    }
    try {
      const specialty = await this.prisma.specialty.create({
        data: { name: input.name.trim(), universityId: actor.universityId },
        select: SPECIALTY_SELECT,
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

  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const specialty = await this.prisma.specialty.findUnique({
      where: { id },
      select: { id: true, universityId: true },
    })
    if (!specialty) {
      throw new AppException('NOT_FOUND', 'Специальность не найдена')
    }
    if (specialty.universityId !== actor.universityId) {
      throw new AppException('WRONG_SCOPE', 'Ресурс другого университета')
    }
    await this.prisma.specialty.delete({ where: { id } })
    await this.audit.record({
      userId: actor.sub,
      action: 'specialty_deleted',
      entity: 'Specialty',
      entityId: id,
      ...ctx,
    })
  }
}
