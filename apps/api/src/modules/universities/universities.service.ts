import { Inject, Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type Redis from 'ioredis'
import { Role } from '@studenthub/shared-types'
import type {
  CreateUniversityInput,
  UpdateUniversityInput,
  UpdateUniversityStatusInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { REDIS_CLIENT } from '../../common/redis/redis.module'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'

const UNIVERSITY_SELECT = {
  id: true,
  name: true,
  shortName: true,
  status: true,
  country: true,
  city: true,
  timezone: true,
  createdAt: true,
} satisfies Prisma.UniversitySelect

const STATS_TTL_SECONDS = 300
const statsKey = (id: string): string => `stats:university:${id}`

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

@Injectable()
export class UniversityService {
  private readonly logger = new Logger(UniversityService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Создание вуза (PLATFORM_ADMIN). Статус по умолчанию PENDING. */
  async create(actor: JwtPayload, input: CreateUniversityInput, ctx: RequestContext) {
    const university = await this.prisma.university.create({
      data: input,
      select: UNIVERSITY_SELECT,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'university_created',
      entity: 'University',
      entityId: university.id,
      metadata: { name: university.name },
      ...ctx,
    })
    return university
  }

  /** Список вузов (только платформа). Offset-пагинация. */
  async list(page: number, limit: number) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.university.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: UNIVERSITY_SELECT,
      }),
      this.prisma.university.count(),
    ])
    return new Paginated(items, { total })
  }

  /** Профиль вуза. Платформа — любой; иначе только свой (scope). */
  async getById(viewer: JwtPayload, id: string) {
    const university = await this.findOrThrow(id)
    this.assertScope(viewer, id)
    return university
  }

  /** Обновление реквизитов вуза (PLATFORM_ADMIN). */
  async update(actor: JwtPayload, id: string, input: UpdateUniversityInput, ctx: RequestContext) {
    await this.findOrThrow(id)
    const university = await this.prisma.university.update({
      where: { id },
      data: input,
      select: UNIVERSITY_SELECT,
    })
    await this.invalidateStats(id)
    await this.audit.record({
      userId: actor.sub,
      action: 'university_updated',
      entity: 'University',
      entityId: id,
      ...ctx,
    })
    return university
  }

  /** Смена статуса PENDING/ACTIVE/BLOCKED (только PLATFORM_ADMIN). */
  async setStatus(
    actor: JwtPayload,
    id: string,
    input: UpdateUniversityStatusInput,
    ctx: RequestContext,
  ) {
    await this.findOrThrow(id)
    const university = await this.prisma.university.update({
      where: { id },
      data: { status: input.status },
      select: UNIVERSITY_SELECT,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'university_status_changed',
      entity: 'University',
      entityId: id,
      metadata: { status: input.status },
      ...ctx,
    })
    return university
  }

  /** Удаление вуза (PLATFORM_ADMIN). Запрещено при наличии факультетов/пользователей/аудиторий. */
  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    await this.findOrThrow(id)
    try {
      await this.prisma.university.delete({ where: { id } })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new AppException(
          'CONFLICT',
          'Нельзя удалить вуз с факультетами, аудиториями или пользователями',
        )
      }
      throw error
    }
    await this.invalidateStats(id)
    await this.audit.record({
      userId: actor.sub,
      action: 'university_deleted',
      entity: 'University',
      entityId: id,
      ...ctx,
    })
  }

  /** Статистика вуза с Redis-кэшем (TTL 5 мин). Платформа — любой; иначе только свой. */
  async getStats(viewer: JwtPayload, id: string) {
    await this.findOrThrow(id)
    this.assertScope(viewer, id)

    const cached = await this.redis.get(statsKey(id))
    if (cached) {
      return JSON.parse(cached) as Awaited<ReturnType<UniversityService['computeStats']>>
    }
    const stats = await this.computeStats(id)
    await this.redis.set(statsKey(id), JSON.stringify(stats), 'EX', STATS_TTL_SECONDS)
    return stats
  }

  private async computeStats(id: string) {
    const [faculties, groups, rooms, students, teachers] = await this.prisma.$transaction([
      this.prisma.faculty.count({ where: { universityId: id } }),
      this.prisma.group.count({ where: { faculty: { universityId: id } } }),
      this.prisma.room.count({ where: { universityId: id } }),
      this.prisma.user.count({ where: { universityId: id, role: Role.STUDENT, deletedAt: null } }),
      this.prisma.user.count({ where: { universityId: id, role: Role.TEACHER, deletedAt: null } }),
    ])
    return { faculties, groups, rooms, students, teachers }
  }

  private async findOrThrow(id: string) {
    const university = await this.prisma.university.findUnique({
      where: { id },
      select: UNIVERSITY_SELECT,
    })
    if (!university) {
      throw new AppException('NOT_FOUND', 'Университет не найден')
    }
    return university
  }

  // Платформенные роли видят любой вуз; остальные — только свой (docs/PROJECT.md §3.2).
  private assertScope(viewer: JwtPayload, universityId: string): void {
    if (isPlatform(viewer.role)) {
      return
    }
    if (viewer.universityId !== universityId) {
      throw new AppException('WRONG_SCOPE', 'Ресурс другого университета')
    }
  }

  /** Сброс кэша статистики вуза (вызывается при изменении факультетов/групп/пользователей). */
  async invalidateStats(id: string): Promise<void> {
    try {
      await this.redis.del(statsKey(id))
    } catch (error) {
      this.logger.warn(`Не удалось сбросить кэш статистики вуза ${id}: ${(error as Error).message}`)
    }
  }
}
