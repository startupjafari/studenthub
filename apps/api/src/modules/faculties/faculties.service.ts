import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type { CreateFacultyInput, UpdateFacultyInput } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { UniversityService } from '../universities/universities.service'

const FACULTY_SELECT = {
  id: true,
  name: true,
  universityId: true,
  createdAt: true,
} satisfies Prisma.FacultySelect

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

@Injectable()
export class FacultyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly universities: UniversityService,
  ) {}

  /** Создание факультета. Платформа — в любой вуз; UNIVERSITY_ADMIN — только в свой. */
  async create(actor: JwtPayload, input: CreateFacultyInput, ctx: RequestContext) {
    this.assertScope(actor, input.universityId)
    const university = await this.prisma.university.findUnique({
      where: { id: input.universityId },
      select: { id: true },
    })
    if (!university) {
      throw new AppException('NOT_FOUND', 'Университет не найден')
    }
    const faculty = await this.prisma.faculty.create({
      data: { name: input.name, universityId: input.universityId },
      select: FACULTY_SELECT,
    })
    await this.universities.invalidateStats(input.universityId)
    await this.audit.record({
      userId: actor.sub,
      action: 'faculty_created',
      entity: 'Faculty',
      entityId: faculty.id,
      metadata: { universityId: input.universityId },
      ...ctx,
    })
    return faculty
  }

  /** Список факультетов. Платформа — любые (с опц. фильтром по вузу); иначе только свой вуз. */
  async list(viewer: JwtPayload, page: number, limit: number, universityId?: string) {
    const where = this.listWhere(viewer, universityId)
    const [items, total] = await this.prisma.$transaction([
      this.prisma.faculty.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: FACULTY_SELECT,
      }),
      this.prisma.faculty.count({ where }),
    ])
    return new Paginated(items, { total })
  }

  async getById(viewer: JwtPayload, id: string) {
    const faculty = await this.findOrThrow(id)
    this.assertScope(viewer, faculty.universityId)
    return faculty
  }

  async update(actor: JwtPayload, id: string, input: UpdateFacultyInput, ctx: RequestContext) {
    const faculty = await this.findOrThrow(id)
    this.assertScope(actor, faculty.universityId)
    const updated = await this.prisma.faculty.update({
      where: { id },
      data: { name: input.name },
      select: FACULTY_SELECT,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'faculty_updated',
      entity: 'Faculty',
      entityId: id,
      ...ctx,
    })
    return updated
  }

  /** Удаление факультета — запрещено при наличии групп (FK Restrict → CONFLICT). */
  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const faculty = await this.findOrThrow(id)
    this.assertScope(actor, faculty.universityId)
    try {
      await this.prisma.faculty.delete({ where: { id } })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new AppException('CONFLICT', 'Нельзя удалить факультет с группами или пользователями')
      }
      throw error
    }
    await this.universities.invalidateStats(faculty.universityId)
    await this.audit.record({
      userId: actor.sub,
      action: 'faculty_deleted',
      entity: 'Faculty',
      entityId: id,
      ...ctx,
    })
  }

  private async findOrThrow(id: string) {
    const faculty = await this.prisma.faculty.findUnique({ where: { id }, select: FACULTY_SELECT })
    if (!faculty) {
      throw new AppException('NOT_FOUND', 'Факультет не найден')
    }
    return faculty
  }

  private listWhere(viewer: JwtPayload, universityId?: string): Prisma.FacultyWhereInput {
    if (isPlatform(viewer.role)) {
      return universityId ? { universityId } : {}
    }
    // Не-платформенные роли видят только факультеты своего вуза.
    return { universityId: viewer.universityId ?? '__none__' }
  }

  // Платформа управляет любым вузом; остальные — только своим (docs/PROJECT.md §3.2).
  private assertScope(viewer: JwtPayload, universityId: string): void {
    if (isPlatform(viewer.role)) {
      return
    }
    if (viewer.universityId !== universityId) {
      throw new AppException('WRONG_SCOPE', 'Ресурс другого университета')
    }
  }
}
