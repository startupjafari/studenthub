import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  AssignStarostaInput,
  CreateGroupInput,
  GroupListQueryInput,
  UpdateGroupInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { advisoryXactLock } from '../../common/prisma/advisory-lock'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { UserService } from '../users/users.service'
import { UniversityService } from '../universities/universities.service'
import { InviteService } from '../invites/invites.service'

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

// Что не даёт удалить группу — в порядке, в котором это разбирают руками: сначала переводят
// студентов, потом убирают расписание и учебные записи. Ключ уходит клиенту в details.field.
const GROUP_DELETION_BLOCKERS = ['students', 'schedule', 'courses', 'exams', 'materials'] as const
type GroupDeletionBlocker = (typeof GROUP_DELETION_BLOCKERS)[number]

const GROUP_DELETION_LABELS: Record<GroupDeletionBlocker, string> = {
  students: 'студенты',
  schedule: 'расписание',
  courses: 'курсы',
  exams: 'экзамены',
  materials: 'материалы',
}

/** Название без пробелов по краям; одни пробелы — не название. */
function groupName(raw: string): string {
  const name = raw.trim()
  if (!name) {
    throw new AppException('VALIDATION_ERROR', 'Укажите название группы', [
      { field: 'name', message: 'Укажите название группы' },
    ])
  }
  return name
}

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
    private readonly users: UserService,
    private readonly invites: InviteService,
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

    const name = groupName(input.name)
    const group = await this.prisma.$transaction(async (tx) => {
      await this.assertNameFree(tx, input.facultyId, name)
      return tx.group.create({
        data: { name, year: input.year, facultyId: input.facultyId },
        select: GROUP_SELECT,
      })
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

  /**
   * Список групп, отфильтрованный по scope смотрящего. `search` — подстрока названия без
   * учёта регистра. Вторичный ключ `id`: одноимённые группы разных факультетов иначе
   * менялись бы местами между запросами, и на стыке страниц одна приходила бы дважды,
   * а другая терялась.
   */
  async list(viewer: JwtPayload, query: GroupListQueryInput) {
    const { page, limit, facultyId, search } = query
    const where: Prisma.GroupWhereInput = {
      ...this.listWhere(viewer, facultyId),
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.group.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
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
    const name = input.name === undefined ? undefined : groupName(input.name)
    const updated = await this.prisma.$transaction(async (tx) => {
      if (name !== undefined) {
        await this.assertNameFree(tx, group.facultyId, name, id)
      }
      return tx.group.update({
        where: { id },
        data: { name, year: input.year },
        select: GROUP_SELECT,
      })
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
        select: { id: true, groupId: true, role: true, isBlocked: true },
      })
      // Старостой становится студент этой группы: преподаватель или сотрудник с тем же
      // groupId (такого быть не должно, но данные бывают кривыми) роль не меняет.
      if (
        !user ||
        user.groupId !== id ||
        user.isBlocked ||
        (user.role !== Role.STUDENT && user.role !== Role.STAROSTA)
      ) {
        throw new AppException(
          'BAD_REQUEST',
          'Старостой можно назначить только студента этой группы',
        )
      }
    }

    // Отметка в группе и роли — одной транзакцией: староста без роли не получил бы ни меню,
    // ни прав, а роль без отметки — не значилась бы старостой группы.
    let updated: GroupRow
    let demoted: string[]
    try {
      ;({ updated, demoted } = await this.prisma.$transaction(async (tx) => {
        const row = await tx.group.update({
          where: { id },
          data: { starostaId: input.starostaId },
          select: GROUP_SELECT,
        })
        const ids = await this.users.syncGroupStarosta(tx, id, input.starostaId)
        return { updated: row, demoted: ids }
      }))
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException('CONFLICT', 'Этот пользователь уже староста другой группы')
      }
      throw error
    }
    await this.users.afterStarostaChange(actor.sub, id, input.starostaId, demoted)
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

  /**
   * Удаление группы — только пустой: без студентов, расписания, курсов, экзаменов и материалов.
   *
   * Студенты и расписание держат группу связью Restrict, а курсы, экзамены и материалы
   * привязаны к ней каскадом. Без проверки удаление группы, из которой студентов перевели
   * в другую, молча стирало курсы с заданиями и сдачами, журнал оценок, экзамены с
   * результатами и материалы — академическую историю этих студентов. Поэтому всё это
   * считается заранее, и в ответе — что именно мешает (details.field — вид записей).
   *
   * Подсчёт и удаление — одна транзакция под блокировкой строки группы (FOR UPDATE).
   * Вставка курса, экзамена или материала проверяет внешний ключ и берёт на строку группы
   * FOR KEY SHARE, несовместимую с FOR UPDATE: заведённое параллельно либо попадает
   * в подсчёт, либо ждёт удаления и падает на внешнем ключе — каскадом не исчезает.
   *
   * Ожидающие приглашения в группу отзываются в той же транзакции первым шагом, до
   * блокировки группы (порядок — см. InviteService.revokePendingInScope). Отказ в удалении
   * откатывает и отзыв.
   */
  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const group = await this.findOrThrow(id)
    this.assertUniversityScope(actor, group.universityId)
    let revokedInvites = 0
    try {
      revokedInvites = await this.prisma.$transaction(async (tx) => {
        const revoked = await this.invites.revokePendingInScope(tx, { groupId: id })
        await tx.$queryRaw`SELECT id FROM "groups" WHERE id = ${id} FOR UPDATE`
        const blockers = await this.deletionBlockers(tx, id)
        if (blockers.length > 0) {
          throw new AppException(
            'CONFLICT',
            `Нельзя удалить группу, пока в ней есть: ${blockers.map((b) => b.message).join(', ')}`,
            blockers,
          )
        }
        await tx.group.delete({ where: { id } })
        return revoked
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        // Страховка: подсчёт выше видит все связи Restrict, сюда попадать не должно.
        throw new AppException('CONFLICT', 'Нельзя удалить группу: на неё ссылаются другие записи')
      }
      throw error
    }
    await this.universities.invalidateStats(group.universityId)
    await this.audit.record({
      userId: actor.sub,
      action: 'group_deleted',
      entity: 'Group',
      entityId: id,
      metadata: { revokedInvites },
      ...ctx,
    })
  }

  /**
   * Что держит группу от удаления. Посещаемость висит на парах расписания, задания и
   * журнал оценок — на курсах, поэтому отдельно их не считаем.
   *
   * Счётчики по чужим таблицам читаются здесь напрямую, вопреки правилу самодостаточности
   * модуля (BACKEND_RULES §2.1), — как в `UniversityService.computeStats`. Подсчёт обязан
   * идти в той же транзакции, что и удаление, под блокировкой строки группы: через сервисы
   * это пять новых зависимостей модуля и проброс клиента транзакции в каждый ради пяти
   * `count`. Наружу отсюда идут только числа.
   */
  private async deletionBlockers(
    tx: Prisma.TransactionClient,
    groupId: string,
  ): Promise<{ field: GroupDeletionBlocker; message: string }[]> {
    const counts: Record<GroupDeletionBlocker, number> = {
      students: await tx.user.count({ where: { groupId } }),
      schedule: await tx.schedule.count({ where: { groupId } }),
      courses: await tx.course.count({ where: { groupId } }),
      exams: await tx.exam.count({ where: { groupId } }),
      materials: await tx.material.count({ where: { groupId } }),
    }
    return GROUP_DELETION_BLOCKERS.filter((field) => counts[field] > 0).map((field) => ({
      field,
      message: `${GROUP_DELETION_LABELS[field]} (${counts[field]})`,
    }))
  }

  /**
   * Название группы свободно на факультете — без учёта регистра.
   *
   * Уникального индекса `(facultyId, name)` в схеме нет, а двойной клик и быстрый ввод
   * в мастере заводили «ИТ-21» дважды — потом их не различить в выборе группы для
   * инвайта и расписания. Поэтому проверка в коде, под advisory-локом на факультет: два
   * параллельных создания идут по очереди, и второе видит первое.
   *
   * `in`, а не `equals` с `mode: 'insensitive'`: equals Prisma строит через ILIKE, где
   * `_` и `%` — шаблоны, и «ИТ_21» совпало бы с «ИТ-21».
   */
  private async assertNameFree(
    tx: Prisma.TransactionClient,
    facultyId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    await advisoryXactLock(tx, `group-name:${facultyId}`)
    const taken = await tx.group.findFirst({
      where: {
        facultyId,
        name: { in: [name], mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    })
    if (taken) {
      throw new AppException('CONFLICT', 'Группа с таким названием на факультете уже есть', [
        { field: 'name', message: 'Группа с таким названием на факультете уже есть' },
      ])
    }
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
