import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type { CreateFacultyInput, UpdateFacultyInput } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { advisoryXactLock } from '../../common/prisma/advisory-lock'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { InviteService } from '../invites/invites.service'
import { UniversityService } from '../universities/universities.service'
import { UserService } from '../users/users.service'

const FACULTY_SELECT = {
  id: true,
  name: true,
  universityId: true,
  createdAt: true,
} satisfies Prisma.FacultySelect

/** Название без пробелов по краям; одни пробелы — не название. */
function facultyName(raw: string): string {
  const name = raw.trim()
  if (!name) {
    throw new AppException('VALIDATION_ERROR', 'Укажите название факультета', [
      { field: 'name', message: 'Укажите название факультета' },
    ])
  }
  return name
}

// Что не даёт удалить факультет (связи Restrict): группы и люди. Ключ уходит клиенту в
// details.field — экран перечисляет, что разбирать, а не пишет «есть группы» про декана.
const FACULTY_DELETION_BLOCKERS = ['groups', 'users'] as const
type FacultyDeletionBlocker = (typeof FACULTY_DELETION_BLOCKERS)[number]

const FACULTY_DELETION_LABELS: Record<FacultyDeletionBlocker, string> = {
  groups: 'группы',
  users: 'пользователи',
}

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

@Injectable()
export class FacultyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly universities: UniversityService,
    private readonly invites: InviteService,
    private readonly users: UserService,
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
    const name = facultyName(input.name)
    const faculty = await this.prisma.$transaction(async (tx) => {
      await this.assertNameFree(tx, input.universityId, name)
      return tx.faculty.create({
        data: { name, universityId: input.universityId },
        select: FACULTY_SELECT,
      })
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
    const name = facultyName(input.name)
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.assertNameFree(tx, faculty.universityId, name, id)
      return tx.faculty.update({
        where: { id },
        data: { name },
        select: FACULTY_SELECT,
      })
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

  /**
   * Удаление факультета — запрещено, пока на нём есть группы или люди (FK Restrict →
   * CONFLICT, в details — что именно мешает: `groups`, `users`).
   *
   * Удалённые аккаунты («надгробия») факультет больше не держат: их привязка к факультету
   * снимается в той же транзакции. Раньше удалить факультет не давал давно удалённый декан,
   * и экран писал «есть группы», которых не было.
   *
   * Ожидающие приглашения на факультет отзываются той же транзакцией первым шагом (см.
   * InviteService.revokePendingInScope): отказ в удалении откатывает и отзыв.
   */
  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const faculty = await this.findOrThrow(id)
    this.assertScope(actor, faculty.universityId)
    let revokedInvites = 0
    try {
      revokedInvites = await this.prisma.$transaction(async (tx) => {
        const revoked = await this.invites.revokePendingInScope(tx, { facultyId: id })
        await this.users.detachDeletedFromFaculty(tx, id)
        const blockers = await this.deletionBlockers(tx, id)
        if (blockers.length > 0) {
          throw new AppException(
            'CONFLICT',
            `Нельзя удалить факультет, пока на нём есть: ${blockers.map((b) => b.message).join(', ')}`,
            blockers,
          )
        }
        await tx.faculty.delete({ where: { id } })
        return revoked
      })
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
      metadata: { revokedInvites },
      ...ctx,
    })
  }

  /**
   * Что держит факультет от удаления: группы и действующие пользователи (удалённых к этому
   * моменту отвязал `UserService.detachDeletedFromFaculty`).
   *
   * Счётчик по таблице пользователей читается здесь напрямую, вопреки правилу
   * самодостаточности модуля (BACKEND_RULES §2.1), — как в `GroupService.deletionBlockers`:
   * подсчёт обязан идти в транзакции удаления, а наружу отсюда идут только числа.
   */
  private async deletionBlockers(
    tx: Prisma.TransactionClient,
    facultyId: string,
  ): Promise<{ field: FacultyDeletionBlocker; message: string }[]> {
    const counts: Record<FacultyDeletionBlocker, number> = {
      groups: await tx.group.count({ where: { facultyId } }),
      users: await tx.user.count({ where: { facultyId } }),
    }
    return FACULTY_DELETION_BLOCKERS.filter((field) => counts[field] > 0).map((field) => ({
      field,
      message: `${FACULTY_DELETION_LABELS[field]} (${counts[field]})`,
    }))
  }

  /**
   * Название факультета свободно в вузе — без учёта регистра.
   *
   * Уникального индекса `(universityId, name)` в схеме нет, а двойной клик и быстрый ввод
   * в мастере заводили «Факультет права» дважды — потом их не различить в выборе
   * факультета для инвайта и расписания. Поэтому проверка в коде, под advisory-локом на
   * вуз: два параллельных создания идут по очереди, и второе видит первое.
   *
   * `in`, а не `equals` с `mode: 'insensitive'`: equals Prisma строит через ILIKE, где
   * `_` и `%` — шаблоны, и «ИТ_1» совпало бы с «ИТ-1».
   */
  private async assertNameFree(
    tx: Prisma.TransactionClient,
    universityId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    await advisoryXactLock(tx, `faculty-name:${universityId}`)
    const taken = await tx.faculty.findFirst({
      where: {
        universityId,
        name: { in: [name], mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    })
    if (taken) {
      throw new AppException('CONFLICT', 'Факультет с таким названием в вузе уже есть', [
        { field: 'name', message: 'Факультет с таким названием в вузе уже есть' },
      ])
    }
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
