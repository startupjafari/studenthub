import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  AssignStarostaInput,
  CreateGroupInput,
  UpdateGroupInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { UniversityService } from '../universities/universities.service'

// Внутренняя выборка для scope: год/факультет + universityId факультета.
const GROUP_SELECT = {
  id: true,
  name: true,
  year: true,
  facultyId: true,
  starostaId: true,
  createdAt: true,
  faculty: { select: { universityId: true } },
} satisfies Prisma.GroupSelect

type GroupRow = Prisma.GroupGetPayload<{ select: typeof GROUP_SELECT }>

interface GroupDto {
  id: string
  name: string
  year: number | null
  facultyId: string
  universityId: string
  starostaId: string | null
  createdAt: Date
}

const MEMBER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  role: true,
  avatarUrl: true,
} satisfies Prisma.UserSelect

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

function mapGroup(row: GroupRow): GroupDto {
  return {
    id: row.id,
    name: row.name,
    year: row.year,
    facultyId: row.facultyId,
    universityId: row.faculty.universityId,
    starostaId: row.starostaId,
    createdAt: row.createdAt,
  }
}

@Injectable()
export class GroupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly universities: UniversityService,
  ) {}

  /** Создание группы (PLATFORM_ADMIN / UNIVERSITY_ADMIN своего вуза). */
  async create(actor: JwtPayload, input: CreateGroupInput, ctx: RequestContext): Promise<GroupDto> {
    const faculty = await this.prisma.faculty.findUnique({
      where: { id: input.facultyId },
      select: { id: true, universityId: true },
    })
    if (!faculty) {
      throw new AppException('NOT_FOUND', 'Факультет не найден')
    }
    this.assertUniversityScope(actor, faculty.universityId)

    const group = await this.prisma.group.create({
      data: { name: input.name, year: input.year, facultyId: input.facultyId },
      select: GROUP_SELECT,
    })
    await this.universities.invalidateStats(faculty.universityId)
    await this.audit.record({
      userId: actor.sub,
      action: 'group_created',
      entity: 'Group',
      entityId: group.id,
      metadata: { facultyId: input.facultyId },
      ...ctx,
    })
    return mapGroup(group)
  }

  /** Список групп, отфильтрованный по scope смотрящего. */
  async list(viewer: JwtPayload, page: number, limit: number, facultyId?: string) {
    const where = this.listWhere(viewer, facultyId)
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.group.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        select: GROUP_SELECT,
      }),
      this.prisma.group.count({ where }),
    ])
    return new Paginated(rows.map(mapGroup), { total })
  }

  async getById(viewer: JwtPayload, id: string): Promise<GroupDto> {
    const group = await this.findOrThrow(id)
    this.assertReadScope(viewer, group)
    return group
  }

  /** Участники группы (студенты + староста). Личные данные (email) не отдаются. */
  async members(viewer: JwtPayload, id: string) {
    const group = await this.findOrThrow(id)
    this.assertReadScope(viewer, group)
    return this.prisma.user.findMany({
      where: { groupId: id, deletedAt: null },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 500,
      select: MEMBER_SELECT,
    })
  }

  async update(
    actor: JwtPayload,
    id: string,
    input: UpdateGroupInput,
    ctx: RequestContext,
  ): Promise<GroupDto> {
    const group = await this.findOrThrow(id)
    this.assertUniversityScope(actor, group.universityId)
    const updated = await this.prisma.group.update({
      where: { id },
      data: { name: input.name, year: input.year },
      select: GROUP_SELECT,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'group_updated',
      entity: 'Group',
      entityId: id,
      ...ctx,
    })
    return mapGroup(updated)
  }

  /** Назначение/снятие старосты. Разрешено PLATFORM_ADMIN, UNIVERSITY_ADMIN (свой вуз), DEAN (свой факультет). */
  async assignStarosta(
    actor: JwtPayload,
    id: string,
    input: AssignStarostaInput,
    ctx: RequestContext,
  ): Promise<GroupDto> {
    const group = await this.findOrThrow(id)
    this.assertStarostaScope(actor, group)

    if (input.starostaId !== null) {
      const user = await this.prisma.user.findFirst({
        where: { id: input.starostaId, deletedAt: null },
        select: { id: true, groupId: true },
      })
      if (!user || user.groupId !== id) {
        throw new AppException(
          'BAD_REQUEST',
          'Старостой можно назначить только участника этой группы',
        )
      }
    }

    let updated: GroupRow
    try {
      updated = await this.prisma.group.update({
        where: { id },
        data: { starostaId: input.starostaId },
        select: GROUP_SELECT,
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException('CONFLICT', 'Этот пользователь уже староста другой группы')
      }
      throw error
    }
    await this.audit.record({
      userId: actor.sub,
      action: input.starostaId ? 'group_starosta_assigned' : 'group_starosta_cleared',
      entity: 'Group',
      entityId: id,
      metadata: { starostaId: input.starostaId },
      ...ctx,
    })
    return mapGroup(updated)
  }

  /** Удаление группы — запрещено при наличии студентов/старосты (FK Restrict → CONFLICT). */
  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const group = await this.findOrThrow(id)
    this.assertUniversityScope(actor, group.universityId)
    try {
      await this.prisma.group.delete({ where: { id } })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new AppException('CONFLICT', 'Нельзя удалить группу со студентами')
      }
      throw error
    }
    await this.universities.invalidateStats(group.universityId)
    await this.audit.record({
      userId: actor.sub,
      action: 'group_deleted',
      entity: 'Group',
      entityId: id,
      ...ctx,
    })
  }

  private async findOrThrow(id: string): Promise<GroupDto> {
    const group = await this.prisma.group.findUnique({ where: { id }, select: GROUP_SELECT })
    if (!group) {
      throw new AppException('NOT_FOUND', 'Группа не найдена')
    }
    return mapGroup(group)
  }

  private listWhere(viewer: JwtPayload, facultyId?: string): Prisma.GroupWhereInput {
    if (isPlatform(viewer.role)) {
      return facultyId ? { facultyId } : {}
    }
    if (viewer.role === Role.DEAN) {
      return { facultyId: viewer.facultyId ?? '__none__' }
    }
    if (viewer.role === Role.STAROSTA || viewer.role === Role.STUDENT) {
      return { id: viewer.groupId ?? '__none__' }
    }
    // UNIVERSITY_ADMIN / UNIVERSITY_MODERATOR / TEACHER — весь свой вуз.
    const base: Prisma.GroupWhereInput = {
      faculty: { universityId: viewer.universityId ?? '__none__' },
    }
    return facultyId ? { ...base, facultyId } : base
  }

  // Чтение: платформа — любая; вуз-роли — свой вуз; декан — свой факультет; студент/староста — своя группа.
  private assertReadScope(viewer: JwtPayload, group: GroupDto): void {
    if (isPlatform(viewer.role)) return
    if (viewer.role === Role.STAROSTA || viewer.role === Role.STUDENT) {
      if (viewer.groupId === group.id) return
      throw new AppException('WRONG_SCOPE', 'Доступна только своя группа')
    }
    if (viewer.role === Role.DEAN) {
      if (viewer.facultyId === group.facultyId) return
      throw new AppException('WRONG_SCOPE', 'Ресурс другого факультета')
    }
    if (viewer.universityId === group.universityId) return
    throw new AppException('WRONG_SCOPE', 'Ресурс другого университета')
  }

  // Управление структурой (create/update/delete): платформа или админ своего вуза.
  private assertUniversityScope(viewer: JwtPayload, universityId: string): void {
    if (isPlatform(viewer.role)) return
    if (viewer.universityId !== universityId) {
      throw new AppException('WRONG_SCOPE', 'Ресурс другого университета')
    }
  }

  // Назначение старосты: платформа, админ своего вуза или декан своего факультета.
  private assertStarostaScope(viewer: JwtPayload, group: GroupDto): void {
    if (isPlatform(viewer.role)) return
    if (viewer.role === Role.DEAN) {
      if (viewer.facultyId === group.facultyId) return
      throw new AppException('WRONG_SCOPE', 'Ресурс другого факультета')
    }
    if (viewer.universityId === group.universityId) return
    throw new AppException('WRONG_SCOPE', 'Ресурс другого университета')
  }
}
