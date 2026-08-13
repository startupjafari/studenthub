import { Injectable, Logger } from '@nestjs/common'
import { Prisma, ScheduleChangeType, WeekType } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  CreatePairInput,
  CreateScheduleChangeInput,
  CreateScheduleInput,
  ScheduleChangeQueryInput,
  ScheduleQueryInput,
  UpdatePairInput,
  UpdateScheduleInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { RealtimeGateway } from '../../common/realtime'
import { NOTIFICATION_JOBS, QUEUES, QueueService } from '../../common/queue'
import { RoomService } from '../rooms/rooms.service'

// ── select'ы ─────────────────────────────────────────────────────────────────

const PAIR_SELECT = {
  id: true,
  scheduleId: true,
  groupId: true,
  subject: true,
  dayOfWeek: true,
  startTime: true,
  endTime: true,
  weekType: true,
  teacher: { select: { id: true, firstName: true, lastName: true } },
  room: { select: { id: true, name: true } },
} satisfies Prisma.PairSelect

type PairRow = Prisma.PairGetPayload<{ select: typeof PAIR_SELECT }>

const SCHEDULE_SELECT = {
  id: true,
  groupId: true,
  name: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.ScheduleSelect

const CHANGE_SELECT = {
  id: true,
  pairId: true,
  type: true,
  date: true,
  newStartTime: true,
  newEndTime: true,
  note: true,
  createdAt: true,
  newRoom: { select: { id: true, name: true } },
  newTeacher: { select: { id: true, firstName: true, lastName: true } },
  pair: {
    select: { groupId: true, subject: true, dayOfWeek: true, startTime: true, endTime: true },
  },
} satisfies Prisma.ScheduleChangeSelect

// Контекст группы для scope и таймзоны (docs/PROJECT.md §3.1, задача 6.2).
interface GroupContext {
  groupId: string
  facultyId: string
  universityId: string
  timezone: string
}

interface PairDto {
  id: string
  scheduleId: string
  groupId: string
  subject: string
  dayOfWeek: number
  startTime: string
  endTime: string
  weekType: WeekType
  teacher: { id: string; firstName: string; lastName: string } | null
  room: { id: string; name: string } | null
}

// Слот, по которому ищем конфликт (аудитория/преподаватель/группа заняты дважды — §6.4).
interface PairSlot {
  scheduleId: string
  groupId: string
  dayOfWeek: number
  startTime: string
  endTime: string
  weekType: WeekType
  teacherId: string | null
  roomId: string | null
}

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

// Пересечение по чётности недели: BOTH пересекается с любым; иначе — только с равным.
function weekTypesOverlap(a: WeekType, b: WeekType): boolean {
  return a === WeekType.BOTH || b === WeekType.BOTH || a === b
}

// Пересечение интервалов "HH:mm" (строки сравнимы лексикографически при zero-pad).
function timeOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA < endB && startB < endA
}

function mapPair(p: PairRow): PairDto {
  return {
    id: p.id,
    scheduleId: p.scheduleId,
    groupId: p.groupId,
    subject: p.subject,
    dayOfWeek: p.dayOfWeek,
    startTime: p.startTime,
    endTime: p.endTime,
    weekType: p.weekType,
    teacher: p.teacher,
    room: p.room,
  }
}

const CHANGE_TYPE_LABEL: Record<ScheduleChangeType, string> = {
  MOVED: 'перенос занятия',
  ROOM_CHANGED: 'смена аудитории',
  CANCELLED: 'отмена занятия',
  SUBSTITUTED: 'замена преподавателя',
}

@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rooms: RoomService,
    private readonly realtime: RealtimeGateway,
    private readonly queue: QueueService,
  ) {}

  // ── Ролевая выборка расписания (задача 6.3) ────────────────────────────────

  /**
   * Активное расписание по scope смотрящего: студент/староста → своя группа,
   * преподаватель → свои пары, декан → факультет, админ/модератор вуза → вуз, платформа → всё.
   * Возвращает пары + таймзону вуза (время «настенное» в этой зоне, docs/FRONTEND_RULES.md §9).
   */
  async getSchedule(
    viewer: JwtPayload,
    query: ScheduleQueryInput,
  ): Promise<{ timezone: string | null; pairs: PairDto[] }> {
    const where = this.buildReadWhere(viewer, query)
    const pairs = await this.prisma.pair.findMany({
      where,
      select: PAIR_SELECT,
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      take: 500,
    })
    const timezone = await this.resolveViewerTimezone(viewer, query.groupId)
    return { timezone, pairs: pairs.map(mapPair) }
  }

  private buildReadWhere(viewer: JwtPayload, q: ScheduleQueryInput): Prisma.PairWhereInput {
    const where: Prisma.PairWhereInput = { schedule: { is: { isActive: true } } }

    // Роль ограничивает scope; фильтры сужают внутри него.
    if (viewer.role === Role.STUDENT || viewer.role === Role.STAROSTA) {
      where.groupId = viewer.groupId ?? '__none__'
    } else if (viewer.role === Role.TEACHER) {
      where.teacherId = viewer.sub
      if (q.groupId) where.groupId = q.groupId
    } else if (viewer.role === Role.DEAN) {
      where.group = { is: { facultyId: viewer.facultyId ?? '__none__' } }
      if (q.groupId) where.groupId = q.groupId
      if (q.teacherId) where.teacherId = q.teacherId
    } else if (isPlatform(viewer.role)) {
      if (q.groupId) where.groupId = q.groupId
      if (q.teacherId) where.teacherId = q.teacherId
    } else {
      // UNIVERSITY_ADMIN / UNIVERSITY_MODERATOR — весь свой вуз.
      where.group = { is: { faculty: { is: { universityId: viewer.universityId ?? '__none__' } } } }
      if (q.groupId) where.groupId = q.groupId
      if (q.teacherId) where.teacherId = q.teacherId
    }

    // Общие фильтры (действуют для всех ролей в пределах их scope).
    if (q.roomId) where.roomId = q.roomId
    if (q.dayOfWeek) where.dayOfWeek = q.dayOfWeek
    if (q.subject) where.subject = { contains: q.subject, mode: 'insensitive' }
    if (q.weekType && q.weekType !== WeekType.BOTH) {
      // Неделя чётная/нечётная: показываем пары этой чётности + идущие каждую неделю.
      where.weekType = { in: [q.weekType as WeekType, WeekType.BOTH] }
    }
    return where
  }

  // ── Контейнеры расписания (Schedule) ───────────────────────────────────────

  async listSchedules(viewer: JwtPayload, groupId?: string) {
    const where = this.scheduleScopeWhere(viewer, groupId)
    return this.prisma.schedule.findMany({
      where,
      select: SCHEDULE_SELECT,
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    })
  }

  async getScheduleById(viewer: JwtPayload, id: string) {
    const schedule = await this.prisma.schedule.findUnique({
      where: { id },
      select: SCHEDULE_SELECT,
    })
    if (!schedule) {
      throw new AppException('NOT_FOUND', 'Расписание не найдено')
    }
    const gctx = await this.resolveGroupContext(schedule.groupId)
    this.assertReadScopeForGroup(viewer, gctx)
    const pairs = await this.prisma.pair.findMany({
      where: { scheduleId: id },
      select: PAIR_SELECT,
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      take: 500,
    })
    return { ...schedule, timezone: gctx.timezone, pairs: pairs.map(mapPair) }
  }

  async createSchedule(actor: JwtPayload, input: CreateScheduleInput, ctx: RequestContext) {
    const gctx = await this.resolveGroupContext(input.groupId)
    this.assertManageScopeForGroup(actor, gctx)
    const makeActive = input.isActive ?? true
    const schedule = await this.prisma.$transaction(async (tx) => {
      if (makeActive) {
        // Единственность активного расписания на группу (комментарий в схеме 03-schedule.prisma).
        await tx.schedule.updateMany({
          where: { groupId: input.groupId, isActive: true },
          data: { isActive: false },
        })
      }
      return tx.schedule.create({
        data: { groupId: input.groupId, name: input.name, isActive: makeActive },
        select: SCHEDULE_SELECT,
      })
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'schedule_created',
      entity: 'Schedule',
      entityId: schedule.id,
      metadata: { groupId: input.groupId },
      ...ctx,
    })
    return schedule
  }

  async updateSchedule(
    actor: JwtPayload,
    id: string,
    input: UpdateScheduleInput,
    ctx: RequestContext,
  ) {
    const existing = await this.prisma.schedule.findUnique({
      where: { id },
      select: { id: true, groupId: true },
    })
    if (!existing) {
      throw new AppException('NOT_FOUND', 'Расписание не найдено')
    }
    const gctx = await this.resolveGroupContext(existing.groupId)
    this.assertManageScopeForGroup(actor, gctx)
    const schedule = await this.prisma.$transaction(async (tx) => {
      if (input.isActive === true) {
        await tx.schedule.updateMany({
          where: { groupId: existing.groupId, isActive: true, id: { not: id } },
          data: { isActive: false },
        })
      }
      return tx.schedule.update({
        where: { id },
        data: { name: input.name, isActive: input.isActive },
        select: SCHEDULE_SELECT,
      })
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'schedule_updated',
      entity: 'Schedule',
      entityId: id,
      ...ctx,
    })
    return schedule
  }

  async removeSchedule(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const existing = await this.prisma.schedule.findUnique({
      where: { id },
      select: { id: true, groupId: true },
    })
    if (!existing) {
      throw new AppException('NOT_FOUND', 'Расписание не найдено')
    }
    const gctx = await this.resolveGroupContext(existing.groupId)
    this.assertManageScopeForGroup(actor, gctx)
    // Пары и их изменения удаляются каскадом (onDelete: Cascade в схеме).
    await this.prisma.schedule.delete({ where: { id } })
    await this.audit.record({
      userId: actor.sub,
      action: 'schedule_deleted',
      entity: 'Schedule',
      entityId: id,
      ...ctx,
    })
  }

  // ── Пары (Pair) + детектор конфликтов (задача 6.4) ─────────────────────────

  async createPair(
    actor: JwtPayload,
    input: CreatePairInput,
    ctx: RequestContext,
  ): Promise<PairDto> {
    const schedule = await this.prisma.schedule.findUnique({
      where: { id: input.scheduleId },
      select: { id: true, groupId: true },
    })
    if (!schedule) {
      throw new AppException('NOT_FOUND', 'Расписание не найдено')
    }
    const gctx = await this.resolveGroupContext(schedule.groupId)
    const teacherId = input.teacherId ?? null
    if (actor.role === Role.TEACHER) {
      // Преподаватель создаёт только СВОИ пары (назначает себя), в своём вузе.
      this.assertTeacherPairScope(actor, gctx, teacherId)
    } else {
      this.assertManageScopeForGroup(actor, gctx)
    }

    const roomId = input.roomId ?? null
    if (roomId) await this.rooms.assertRoomInUniversity(roomId, gctx.universityId)
    if (teacherId) await this.assertTeacherInUniversity(teacherId, gctx.universityId)

    const slot: PairSlot = {
      scheduleId: schedule.id,
      groupId: schedule.groupId,
      dayOfWeek: input.dayOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
      weekType: (input.weekType ?? WeekType.BOTH) as WeekType,
      teacherId,
      roomId,
    }
    await this.assertNoConflict(slot)

    const pair = await this.prisma.pair.create({
      data: {
        scheduleId: slot.scheduleId,
        groupId: slot.groupId,
        subject: input.subject,
        teacherId,
        roomId,
        dayOfWeek: slot.dayOfWeek,
        startTime: slot.startTime,
        endTime: slot.endTime,
        weekType: slot.weekType,
      },
      select: PAIR_SELECT,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'pair_created',
      entity: 'Pair',
      entityId: pair.id,
      metadata: { scheduleId: schedule.id, groupId: schedule.groupId },
      ...ctx,
    })
    return mapPair(pair)
  }

  async updatePair(
    actor: JwtPayload,
    id: string,
    input: UpdatePairInput,
    ctx: RequestContext,
  ): Promise<PairDto> {
    const existing = await this.prisma.pair.findUnique({
      where: { id },
      select: {
        id: true,
        scheduleId: true,
        groupId: true,
        dayOfWeek: true,
        startTime: true,
        endTime: true,
        weekType: true,
        teacherId: true,
        roomId: true,
      },
    })
    if (!existing) {
      throw new AppException('NOT_FOUND', 'Пара не найдена')
    }
    const gctx = await this.resolveGroupContext(existing.groupId)
    if (actor.role === Role.TEACHER) {
      // Преподаватель правит только СВОИ пары и не может переназначить их другому.
      this.assertTeacherPairScope(actor, gctx, existing.teacherId)
      const nextTeacherId = input.teacherId !== undefined ? input.teacherId : existing.teacherId
      if (nextTeacherId !== actor.sub) {
        throw new AppException('WRONG_SCOPE', 'Нельзя переназначить пару другому преподавателю')
      }
    } else {
      this.assertManageScopeForGroup(actor, gctx)
    }

    // undefined = поле не меняем; null = снять преподавателя/аудиторию.
    const teacherId = input.teacherId !== undefined ? input.teacherId : existing.teacherId
    const roomId = input.roomId !== undefined ? input.roomId : existing.roomId
    const dayOfWeek = input.dayOfWeek ?? existing.dayOfWeek
    const startTime = input.startTime ?? existing.startTime
    const endTime = input.endTime ?? existing.endTime
    const weekType = (input.weekType ?? existing.weekType) as WeekType

    // Схема проверяет start<end только когда оба переданы; при частичном апдейте сверяем с итоговыми.
    if (startTime >= endTime) {
      throw new AppException('BAD_REQUEST', 'Время начала должно быть раньше времени окончания')
    }
    if (roomId) await this.rooms.assertRoomInUniversity(roomId, gctx.universityId)
    if (teacherId) await this.assertTeacherInUniversity(teacherId, gctx.universityId)

    await this.assertNoConflict(
      {
        scheduleId: existing.scheduleId,
        groupId: existing.groupId,
        dayOfWeek,
        startTime,
        endTime,
        weekType,
        teacherId,
        roomId,
      },
      id,
    )

    const pair = await this.prisma.pair.update({
      where: { id },
      data: {
        subject: input.subject,
        teacherId,
        roomId,
        dayOfWeek,
        startTime,
        endTime,
        weekType,
      },
      select: PAIR_SELECT,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'pair_updated',
      entity: 'Pair',
      entityId: id,
      ...ctx,
    })
    return mapPair(pair)
  }

  async removePair(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const existing = await this.prisma.pair.findUnique({
      where: { id },
      select: { id: true, groupId: true, teacherId: true },
    })
    if (!existing) {
      throw new AppException('NOT_FOUND', 'Пара не найдена')
    }
    const gctx = await this.resolveGroupContext(existing.groupId)
    if (actor.role === Role.TEACHER) {
      this.assertTeacherPairScope(actor, gctx, existing.teacherId)
    } else {
      this.assertManageScopeForGroup(actor, gctx)
    }
    await this.prisma.pair.delete({ where: { id } })
    await this.audit.record({
      userId: actor.sub,
      action: 'pair_deleted',
      entity: 'Pair',
      entityId: id,
      ...ctx,
    })
  }

  /**
   * Детектор конфликтов (§6.4): в одном слоте (день + пересечение времени + пересечение чётности)
   * аудитория, преподаватель и группа не могут быть заняты дважды. Проверяем среди пар активных
   * расписаний и того же контейнера (архивные неактивные расписания не учитываем).
   */
  private async assertNoConflict(slot: PairSlot, excludePairId?: string): Promise<void> {
    const orResource: Prisma.PairWhereInput[] = [{ groupId: slot.groupId }]
    if (slot.teacherId) orResource.push({ teacherId: slot.teacherId })
    if (slot.roomId) orResource.push({ roomId: slot.roomId })

    const candidates = await this.prisma.pair.findMany({
      where: {
        ...(excludePairId ? { id: { not: excludePairId } } : {}),
        dayOfWeek: slot.dayOfWeek,
        schedule: { is: { OR: [{ isActive: true }, { id: slot.scheduleId }] } },
        OR: orResource,
      },
      select: {
        id: true,
        subject: true,
        startTime: true,
        endTime: true,
        weekType: true,
        groupId: true,
        teacherId: true,
        roomId: true,
      },
    })

    const conflicts: { field: string; message: string }[] = []
    for (const c of candidates) {
      if (!weekTypesOverlap(slot.weekType, c.weekType)) continue
      if (!timeOverlap(slot.startTime, slot.endTime, c.startTime, c.endTime)) continue
      const at = `${c.subject} (${c.startTime}–${c.endTime})`
      if (c.groupId === slot.groupId) {
        conflicts.push({ field: 'groupId', message: `Группа уже занята: ${at}` })
      }
      if (slot.teacherId && c.teacherId === slot.teacherId) {
        conflicts.push({ field: 'teacherId', message: `Преподаватель уже занят: ${at}` })
      }
      if (slot.roomId && c.roomId === slot.roomId) {
        conflicts.push({ field: 'roomId', message: `Аудитория уже занята: ${at}` })
      }
    }
    if (conflicts.length > 0) {
      throw new AppException('CONFLICT', 'Конфликт в расписании', conflicts)
    }
  }

  // ── Разовые изменения (ScheduleChange) + WS + уведомление (задача 6.5) ──────

  async createChange(actor: JwtPayload, input: CreateScheduleChangeInput, ctx: RequestContext) {
    const pair = await this.prisma.pair.findUnique({
      where: { id: input.pairId },
      select: { id: true, groupId: true, subject: true, teacherId: true },
    })
    if (!pair) {
      throw new AppException('NOT_FOUND', 'Пара не найдена')
    }
    const gctx = await this.resolveGroupContext(pair.groupId)
    this.assertManageScopeForGroup(actor, gctx)

    const newRoomId = input.newRoomId ?? null
    const newTeacherId = input.newTeacherId ?? null
    if (newRoomId) await this.rooms.assertRoomInUniversity(newRoomId, gctx.universityId)
    if (newTeacherId) await this.assertTeacherInUniversity(newTeacherId, gctx.universityId)

    const change = await this.prisma.scheduleChange.create({
      data: {
        pairId: pair.id,
        type: input.type as ScheduleChangeType,
        date: new Date(`${input.date}T00:00:00.000Z`),
        newRoomId,
        newTeacherId,
        newStartTime: input.newStartTime,
        newEndTime: input.newEndTime,
        note: input.note,
        createdById: actor.sub,
      },
      select: CHANGE_SELECT,
    })

    await this.audit.record({
      userId: actor.sub,
      action: 'schedule_change_created',
      entity: 'ScheduleChange',
      entityId: change.id,
      metadata: { pairId: pair.id, groupId: pair.groupId, type: input.type },
      ...ctx,
    })

    // §10: сначала БД (выше), затем трансляция. WS-событие живого обновления сетки — в комнату группы.
    this.realtime.emitToRoom(`group:${pair.groupId}`, 'schedule:changed', {
      change,
      groupId: pair.groupId,
    })
    // Параллельно — единый конверт (PR-8/#12); старое событие выше не трогаем.
    this.realtime.emitEventToRoom(`group:${pair.groupId}`, 'schedule.lesson.updated', change.id, {
      change,
      groupId: pair.groupId,
    })

    // Уведомление участникам группы (+ преподавателям пары/замены) через очередь `notifications`.
    await this.enqueueChangeNotification(pair, change.id, input)

    return change
  }

  async listChanges(viewer: JwtPayload, query: ScheduleChangeQueryInput) {
    const pairWhere = this.changePairScope(viewer, query)
    const from = new Date(`${query.from}T00:00:00.000Z`)
    const to = new Date(`${query.to}T00:00:00.000Z`)
    return this.prisma.scheduleChange.findMany({
      where: { date: { gte: from, lte: to }, pair: { is: pairWhere } },
      select: CHANGE_SELECT,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    })
  }

  private async enqueueChangeNotification(
    pair: { id: string; groupId: string; subject: string; teacherId: string | null },
    changeId: string,
    input: CreateScheduleChangeInput,
  ): Promise<void> {
    const members = await this.prisma.user.findMany({
      where: { groupId: pair.groupId, deletedAt: null },
      select: { id: true },
    })
    const recipientIds = new Set(members.map((m) => m.id))
    if (pair.teacherId) recipientIds.add(pair.teacherId)
    if (input.newTeacherId) recipientIds.add(input.newTeacherId)
    if (recipientIds.size === 0) return

    const label = CHANGE_TYPE_LABEL[input.type as ScheduleChangeType]
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      NOTIFICATION_JOBS.SCHEDULE_CHANGED,
      {
        recipientIds: [...recipientIds],
        type: 'SCHEDULE_CHANGE',
        title: 'Изменение в расписании',
        body: `${pair.subject}: ${label} на ${input.date}`,
        data: { pairId: pair.id, changeId, groupId: pair.groupId, date: input.date },
        // Идемпотентность: одно уведомление на изменение (docs/BACKEND_RULES.md §9.2).
        dedupeKey: `schedule-changed:${changeId}`,
      },
      { jobId: `schedule-changed:${changeId}` },
    )
  }

  // ── scope-хелперы ──────────────────────────────────────────────────────────

  private async resolveGroupContext(groupId: string): Promise<GroupContext> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        facultyId: true,
        faculty: { select: { universityId: true, university: { select: { timezone: true } } } },
      },
    })
    if (!group) {
      throw new AppException('NOT_FOUND', 'Группа не найдена')
    }
    return {
      groupId: group.id,
      facultyId: group.facultyId,
      universityId: group.faculty.universityId,
      timezone: group.faculty.university.timezone,
    }
  }

  // Таймзона для отдачи клиенту (задача 6.2): из вуза смотрящего. Платформенные роли без своего
  // вуза могут смотреть по фильтру groupId. Резолвинг таймзоны не должен ронять сам ответ расписания.
  private async resolveViewerTimezone(
    viewer: JwtPayload,
    groupId?: string,
  ): Promise<string | null> {
    if (viewer.universityId) {
      const uni = await this.prisma.university.findUnique({
        where: { id: viewer.universityId },
        select: { timezone: true },
      })
      return uni?.timezone ?? null
    }
    if (groupId && isPlatform(viewer.role)) {
      const group = await this.prisma.group.findUnique({
        where: { id: groupId },
        select: { faculty: { select: { university: { select: { timezone: true } } } } },
      })
      return group?.faculty.university.timezone ?? null
    }
    return null
  }

  private async assertTeacherInUniversity(userId: string, universityId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { universityId: true },
    })
    if (!user) {
      throw new AppException('NOT_FOUND', 'Преподаватель не найден')
    }
    if (user.universityId !== universityId) {
      throw new AppException('WRONG_SCOPE', 'Преподаватель другого университета')
    }
  }

  // Управление (create/update/delete): платформа, админ своего вуза или декан своего факультета.
  // Роли гейтит @Roles на контроллере; здесь — дублирующая проверка фактического scope (§6.1).
  // Преподаватель (§ роль-матрица «свои пары»): управляет ТОЛЬКО парами, где teacherId=он сам,
  // и только в пределах своего вуза. pairTeacherId — преподаватель проверяемой пары (для create — назначаемый).
  private assertTeacherPairScope(
    actor: JwtPayload,
    gctx: GroupContext,
    pairTeacherId: string | null,
  ): void {
    if (gctx.universityId !== actor.universityId) {
      throw new AppException('WRONG_SCOPE', 'Ресурс другого университета')
    }
    if (pairTeacherId !== actor.sub) {
      throw new AppException('WRONG_SCOPE', 'Можно управлять только своими парами')
    }
  }

  private assertManageScopeForGroup(actor: JwtPayload, gctx: GroupContext): void {
    if (isPlatform(actor.role)) return
    if (actor.role === Role.DEAN) {
      if (actor.facultyId === gctx.facultyId) return
      throw new AppException('WRONG_SCOPE', 'Ресурс другого факультета')
    }
    if (actor.role === Role.UNIVERSITY_ADMIN && actor.universityId === gctx.universityId) {
      return
    }
    throw new AppException('WRONG_SCOPE', 'Ресурс другого университета')
  }

  // Чтение конкретного контейнера: платформа/вуз-роли — свой вуз; декан — свой факультет; студент/староста — своя группа.
  private assertReadScopeForGroup(viewer: JwtPayload, gctx: GroupContext): void {
    if (isPlatform(viewer.role)) return
    if (viewer.role === Role.STUDENT || viewer.role === Role.STAROSTA) {
      if (viewer.groupId === gctx.groupId) return
      throw new AppException('WRONG_SCOPE', 'Доступна только своя группа')
    }
    if (viewer.role === Role.DEAN) {
      if (viewer.facultyId === gctx.facultyId) return
      throw new AppException('WRONG_SCOPE', 'Ресурс другого факультета')
    }
    if (viewer.universityId === gctx.universityId) return
    throw new AppException('WRONG_SCOPE', 'Ресурс другого университета')
  }

  private scheduleScopeWhere(viewer: JwtPayload, groupId?: string): Prisma.ScheduleWhereInput {
    if (isPlatform(viewer.role)) {
      return groupId ? { groupId } : {}
    }
    if (viewer.role === Role.STUDENT || viewer.role === Role.STAROSTA) {
      return { groupId: viewer.groupId ?? '__none__' }
    }
    if (viewer.role === Role.DEAN) {
      const base: Prisma.ScheduleWhereInput = {
        group: { is: { facultyId: viewer.facultyId ?? '__none__' } },
      }
      return groupId ? { ...base, groupId } : base
    }
    // UNIVERSITY_ADMIN / UNIVERSITY_MODERATOR / TEACHER — свой вуз.
    const base: Prisma.ScheduleWhereInput = {
      group: { is: { faculty: { is: { universityId: viewer.universityId ?? '__none__' } } } },
    }
    return groupId ? { ...base, groupId } : base
  }

  private changePairScope(
    viewer: JwtPayload,
    query: ScheduleChangeQueryInput,
  ): Prisma.PairWhereInput {
    if (viewer.role === Role.STUDENT || viewer.role === Role.STAROSTA) {
      return { groupId: viewer.groupId ?? '__none__' }
    }
    if (viewer.role === Role.TEACHER) {
      const where: Prisma.PairWhereInput = { teacherId: viewer.sub }
      if (query.groupId) where.groupId = query.groupId
      return where
    }
    const where: Prisma.PairWhereInput = {}
    if (viewer.role === Role.DEAN) {
      where.group = { is: { facultyId: viewer.facultyId ?? '__none__' } }
    } else if (!isPlatform(viewer.role)) {
      where.group = { is: { faculty: { is: { universityId: viewer.universityId ?? '__none__' } } } }
    }
    if (query.groupId) where.groupId = query.groupId
    if (query.teacherId) where.teacherId = query.teacherId
    return where
  }
}
