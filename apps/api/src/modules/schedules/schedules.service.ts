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
import { advisoryXactLock } from '../../common/prisma/advisory-lock'
import { AuditService } from '../../common/audit/audit.service'
import { localDateString } from '../../common/time/local-label'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { RealtimeGateway } from '../../common/realtime'
import { NOTIFICATION_JOBS, QUEUES, QueueService } from '../../common/queue'
import { RoomService } from '../rooms/rooms.service'

// ── select'ы ─────────────────────────────────────────────────────────────────

// Потолки на выборки (BACKEND_RULES §7.2). Пар в дне у группы/преподавателя/помещения
// единицы, студентов в группе — десятки; лимит фиксируем в запросе.
const PAIR_CONFLICT_LIMIT = 500
const GROUP_MEMBERS_LIMIT = 500
// Активация версии сверяет все её пары разом: кандидатов — пары активных сеток других групп
// у тех же преподавателей и аудиторий, это сотни, а не тысячи.
const ACTIVATION_CONFLICT_LIMIT = 5000
// Подробностей конфликта в ответе — сколько дочитают глазами; остальное ясно из первых.
const CONFLICT_DETAILS_LIMIT = 20
// Замен у преподавателя на один день — единицы.
const SUBSTITUTION_LIMIT = 100
// Разовых изменений одной пары на одну дату — единицы (исправления замены поверх замены).
const CHANGES_PER_PAIR_DATE_LIMIT = 20

const DAY_SHORT = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

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

// Отметки посещаемости держат пару (C-F11): удалить пару или версию расписания с отметками
// нельзя — вместе с ними пропала бы история посещаемости за семестр. Проверяем заранее, чтобы
// ответить понятным CONFLICT; связь Attendance.pair = Restrict страхует от гонки (P2003).
const PAIR_HAS_ATTENDANCE =
  'Нельзя удалить пару: по ней уже отмечена посещаемость. Перенесите пару — измените день или время'
const SCHEDULE_HAS_ATTENDANCE =
  'Нельзя удалить версию расписания: по её парам уже отмечена посещаемость. Сделайте версию неактивной'

function attendanceConflict(message: string): AppException {
  return new AppException('CONFLICT', message, [{ field: 'attendance', message }])
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003'
}

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
  // Полные данные пары (scheduleId/weekType/teacher/room добавлены для C-F12): заменяющий
  // не видит эту пару в своей выборке GET /schedule, и клиент строит её из изменения.
  pair: {
    select: {
      scheduleId: true,
      groupId: true,
      subject: true,
      dayOfWeek: true,
      startTime: true,
      endTime: true,
      weekType: true,
      teacher: { select: { id: true, firstName: true, lastName: true } },
      room: { select: { id: true, name: true } },
    },
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

// Календарная дата "YYYY-MM-DD" → значение колонки @db.Date (полночь UTC).
function dateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
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

// Текст уведомления, когда деканат убрал ошибочное изменение (C-F16).
const CHANGE_REVOKED_LABEL: Record<ScheduleChangeType, string> = {
  MOVED: 'перенос отменён, занятие в обычное время',
  ROOM_CHANGED: 'смена аудитории отменена',
  CANCELLED: 'занятие состоится',
  SUBSTITUTED: 'замена преподавателя отменена',
}

/** День недели календарной даты YYYY-MM-DD по ISO (1 — понедельник). Дата уже местная. */
function isoDayOfWeek(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}

// Изменение пары на дату — то, что нужно для расчёта её фактического слота.
interface DatedChange {
  type: ScheduleChangeType
  newStartTime: string | null
  newEndTime: string | null
  newTeacherId: string | null
  newRoomId: string | null
}

// Фактический слот пары в конкретную дату: шаблон с наложенными разовыми изменениями.
interface EffectiveSlot {
  startTime: string
  endTime: string
  teacherId: string | null
  roomId: string | null
}

/**
 * Слот пары в дату с учётом её изменений на эту дату (по порядку создания: позднее
 * перекрывает раннее). Отменённое занятие места не занимает — `null`. Правила те же, что у
 * посещаемости (MOVED — новое время, отмена — занятия нет) и у замен (решает последняя).
 */
function effectiveSlot(base: EffectiveSlot, changes: DatedChange[]): EffectiveSlot | null {
  if (changes.some((c) => c.type === ScheduleChangeType.CANCELLED)) return null
  const slot = { ...base }
  for (const c of changes) {
    if (c.type === ScheduleChangeType.MOVED && c.newStartTime && c.newEndTime) {
      slot.startTime = c.newStartTime
      slot.endTime = c.newEndTime
    }
    if (c.type === ScheduleChangeType.SUBSTITUTED && c.newTeacherId) slot.teacherId = c.newTeacherId
    if (c.type === ScheduleChangeType.ROOM_CHANGED && c.newRoomId) slot.roomId = c.newRoomId
  }
  return slot
}

const DATED_CHANGE_SELECT = {
  type: true,
  newStartTime: true,
  newEndTime: true,
  newTeacherId: true,
  newRoomId: true,
} satisfies Prisma.ScheduleChangeSelect

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

  /**
   * Чужие пары, которые преподаватель ведёт на дату по замене (C-F12).
   *
   * В недельную выборку `getSchedule` они не входят — это шаблон без дат, и пара на каждой
   * неделе показывалась бы как его. Поэтому их отдаёт отдельный вызов на конкретный день
   * («Сегодня»). Решает ПОСЛЕДНЯЯ замена пары на эту дату: деканат исправляет ошибочную замену
   * новой, и прежний заменяющий занятие больше не ведёт.
   */
  async substitutionPairs(viewer: JwtPayload, date: string): Promise<PairDto[]> {
    if (viewer.role !== Role.TEACHER) return []
    const day = dateOnly(date)
    const substitutions = await this.prisma.scheduleChange.findMany({
      where: {
        date: day,
        type: ScheduleChangeType.SUBSTITUTED,
        pair: {
          is: {
            schedule: { is: { isActive: true } },
            changes: {
              some: { date: day, type: ScheduleChangeType.SUBSTITUTED, newTeacherId: viewer.sub },
            },
          },
        },
      },
      select: { pairId: true, newTeacherId: true, pair: { select: PAIR_SELECT } },
      orderBy: { createdAt: 'asc' },
      take: SUBSTITUTION_LIMIT,
    })
    const latest = new Map<string, (typeof substitutions)[number]>()
    for (const s of substitutions) latest.set(s.pairId, s)
    return [...latest.values()]
      .filter((s) => s.newTeacherId === viewer.sub && s.pair.teacher?.id !== viewer.sub)
      .map((s) => mapPair(s.pair))
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
      select: { id: true, groupId: true, isActive: true },
    })
    if (!existing) {
      throw new AppException('NOT_FOUND', 'Расписание не найдено')
    }
    const gctx = await this.resolveGroupContext(existing.groupId)
    this.assertManageScopeForGroup(actor, gctx)
    // Пары черновика проверялись на конфликты с сеткой, действовавшей на момент добавления;
    // с тех пор другие группы могли занять тех же преподавателей и аудитории (C-F13).
    if (input.isActive === true && !existing.isActive) {
      await this.assertActivationNoConflict(existing.id, existing.groupId)
    }
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
    // Пары и их изменения удаляются каскадом, а посещаемость — нет: версию с отметками
    // не удаляем, а деактивируем (C-F11).
    const marked = await this.prisma.attendance.findFirst({
      where: { pair: { is: { scheduleId: id } } },
      select: { id: true },
    })
    if (marked) throw attendanceConflict(SCHEDULE_HAS_ATTENDANCE)
    try {
      await this.prisma.schedule.delete({ where: { id } })
    } catch (error) {
      if (isForeignKeyViolation(error)) throw attendanceConflict(SCHEDULE_HAS_ATTENDANCE)
      throw error
    }
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
      await this.assertTeachesGroup(actor.sub, schedule.groupId)
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
        schedule: { select: { isActive: true } },
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
    // Правка пары действующей сетки — живое обновление группе и обоим преподавателям
    // (C-F16): раньше сетка у них менялась только после перезагрузки.
    if (existing.schedule.isActive) {
      this.broadcastScheduleChange(existing.groupId, [existing.teacherId, teacherId], id, {
        change: null,
        groupId: existing.groupId,
        pairId: id,
      })
    }
    return mapPair(pair)
  }

  async removePair(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const existing = await this.prisma.pair.findUnique({
      where: { id },
      select: {
        id: true,
        groupId: true,
        teacherId: true,
        schedule: { select: { isActive: true } },
      },
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
    // Пару с отметками посещаемости не удаляем (C-F11): её переносят правкой (PATCH).
    const marked = await this.prisma.attendance.findFirst({
      where: { pairId: id },
      select: { id: true },
    })
    if (marked) throw attendanceConflict(PAIR_HAS_ATTENDANCE)
    try {
      await this.prisma.pair.delete({ where: { id } })
    } catch (error) {
      if (isForeignKeyViolation(error)) throw attendanceConflict(PAIR_HAS_ATTENDANCE)
      throw error
    }
    await this.audit.record({
      userId: actor.sub,
      action: 'pair_deleted',
      entity: 'Pair',
      entityId: id,
      ...ctx,
    })
    if (existing.schedule.isActive) {
      this.broadcastScheduleChange(existing.groupId, [existing.teacherId], id, {
        change: null,
        groupId: existing.groupId,
        pairId: id,
        removed: true,
      })
    }
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
      take: PAIR_CONFLICT_LIMIT,
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

  /**
   * Перед активацией версии — её пары против активных расписаний ДРУГИХ групп (C-F13).
   * Действующая версия своей группы при активации гаснет, поэтому с ней конфликт не считаем;
   * пары версии между собой проверены при добавлении (тот же контейнер). Один запрос на всю
   * версию: кандидаты — пары тех же дней у тех же преподавателей и аудиторий.
   */
  private async assertActivationNoConflict(scheduleId: string, groupId: string): Promise<void> {
    const pairs = await this.prisma.pair.findMany({
      where: { scheduleId },
      select: {
        subject: true,
        dayOfWeek: true,
        startTime: true,
        endTime: true,
        weekType: true,
        teacherId: true,
        roomId: true,
      },
      take: 500,
    })
    const teacherIds = [...new Set(pairs.map((p) => p.teacherId).filter((v): v is string => !!v))]
    const roomIds = [...new Set(pairs.map((p) => p.roomId).filter((v): v is string => !!v))]
    if (teacherIds.length === 0 && roomIds.length === 0) return

    const orResource: Prisma.PairWhereInput[] = []
    if (teacherIds.length > 0) orResource.push({ teacherId: { in: teacherIds } })
    if (roomIds.length > 0) orResource.push({ roomId: { in: roomIds } })
    const candidates = await this.prisma.pair.findMany({
      where: {
        groupId: { not: groupId },
        dayOfWeek: { in: [...new Set(pairs.map((p) => p.dayOfWeek))] },
        schedule: { is: { isActive: true } },
        OR: orResource,
      },
      take: ACTIVATION_CONFLICT_LIMIT,
      select: {
        subject: true,
        dayOfWeek: true,
        startTime: true,
        endTime: true,
        weekType: true,
        teacherId: true,
        roomId: true,
      },
    })

    const conflicts: { field: string; message: string }[] = []
    for (const p of pairs) {
      const own = `${p.subject} (${DAY_SHORT[p.dayOfWeek] ?? ''} ${p.startTime}–${p.endTime})`
      for (const c of candidates) {
        if (c.dayOfWeek !== p.dayOfWeek) continue
        if (!weekTypesOverlap(p.weekType, c.weekType)) continue
        if (!timeOverlap(p.startTime, p.endTime, c.startTime, c.endTime)) continue
        const at = `${c.subject} (${c.startTime}–${c.endTime})`
        if (p.teacherId && c.teacherId === p.teacherId) {
          conflicts.push({ field: 'teacherId', message: `${own}: преподаватель уже занят — ${at}` })
        }
        if (p.roomId && c.roomId === p.roomId) {
          conflicts.push({ field: 'roomId', message: `${own}: аудитория уже занята — ${at}` })
        }
      }
    }
    if (conflicts.length > 0) {
      throw new AppException(
        'CONFLICT',
        'Конфликт в расписании',
        conflicts.slice(0, CONFLICT_DETAILS_LIMIT),
      )
    }
  }

  // ── Разовые изменения (ScheduleChange) + WS + уведомление (задача 6.5) ──────

  /**
   * Разовое изменение пары на дату (C-F16 — проверки).
   *
   * Дата должна быть днём этой пары: изменение на вторник для пары по понедельникам никто не
   * увидит, а уведомление о нём уйдёт всей группе. Отменённое занятие не переносят и не
   * заменяют, и вторая отмена на ту же дату — дубль (уведомление ушло бы дважды): сначала
   * убирают отмену (`removeChange`). Перенос, смена аудитории и замена проверяются на
   * занятость преподавателя, аудитории и группы в фактической сетке этой даты.
   *
   * Чётность недели сервер не сверяет — как и посещаемость: формула недели у клиентов
   * расходится с ISO 8601 и ждёт решения продукта (пересечения считаются по чётности пар).
   * Проверка и запись — в транзакции под advisory-локом даты вуза: два параллельных
   * изменения не займут одну аудиторию.
   */
  async createChange(actor: JwtPayload, input: CreateScheduleChangeInput, ctx: RequestContext) {
    const pair = await this.prisma.pair.findUnique({
      where: { id: input.pairId },
      select: {
        id: true,
        scheduleId: true,
        groupId: true,
        subject: true,
        teacherId: true,
        roomId: true,
        dayOfWeek: true,
        startTime: true,
        endTime: true,
        weekType: true,
      },
    })
    if (!pair) {
      throw new AppException('NOT_FOUND', 'Пара не найдена')
    }
    const gctx = await this.resolveGroupContext(pair.groupId)
    this.assertManageScopeForGroup(actor, gctx)

    if (isoDayOfWeek(input.date) !== pair.dayOfWeek) {
      throw new AppException('VALIDATION_ERROR', 'В этот день пары нет', [
        { field: 'date', message: 'День недели не совпадает с днём пары' },
      ])
    }

    const newRoomId = input.newRoomId ?? null
    const newTeacherId = input.newTeacherId ?? null
    if (newRoomId) await this.rooms.assertRoomInUniversity(newRoomId, gctx.universityId)
    if (newTeacherId) await this.assertTeacherInUniversity(newTeacherId, gctx.universityId)

    const type = input.type as ScheduleChangeType
    const day = dateOnly(input.date)
    const change = await this.prisma.$transaction(async (tx) => {
      await advisoryXactLock(tx, `schedule-change:${gctx.universityId}:${input.date}`)
      const own = await tx.scheduleChange.findMany({
        where: { pairId: pair.id, date: day },
        select: DATED_CHANGE_SELECT,
        orderBy: { createdAt: 'asc' },
        take: CHANGES_PER_PAIR_DATE_LIMIT,
      })
      if (own.some((c) => c.type === ScheduleChangeType.CANCELLED)) {
        throw new AppException(
          'CONFLICT',
          type === ScheduleChangeType.CANCELLED
            ? 'Занятие на эту дату уже отменено'
            : 'Занятие на эту дату отменено — сначала уберите отмену',
          [{ field: 'date', message: 'Занятие отменено' }],
        )
      }
      if (type !== ScheduleChangeType.CANCELLED) {
        const next: DatedChange = {
          type,
          newStartTime: input.newStartTime ?? null,
          newEndTime: input.newEndTime ?? null,
          newTeacherId,
          newRoomId,
        }
        await this.assertNoConflictOnDate(tx, pair, day, [...own, next], type)
      }
      return tx.scheduleChange.create({
        data: {
          pairId: pair.id,
          type,
          date: day,
          newRoomId,
          newTeacherId,
          newStartTime: input.newStartTime,
          newEndTime: input.newEndTime,
          note: input.note,
          createdById: actor.sub,
        },
        select: CHANGE_SELECT,
      })
    })

    await this.audit.record({
      userId: actor.sub,
      action: 'schedule_change_created',
      entity: 'ScheduleChange',
      entityId: change.id,
      metadata: { pairId: pair.id, groupId: pair.groupId, type: input.type },
      ...ctx,
    })

    // §10: сначала БД (выше), затем трансляция. Группе — в её комнату; преподаватели в
    // комнате группы не состоят (C-F12): основной и заменяющий получают событие лично,
    // иначе их «Сегодня» не узнавало о замене до перезагрузки.
    this.broadcastScheduleChange(pair.groupId, [pair.teacherId, newTeacherId], change.id, {
      change,
      groupId: pair.groupId,
    })

    // Уведомление участникам группы (+ преподавателям пары/замены) через очередь `notifications`.
    await this.enqueueChangeNotification(pair, change.id, {
      date: input.date,
      label: CHANGE_TYPE_LABEL[type],
      newTeacherId,
      dedupeKey: `schedule-changed:${change.id}`,
    })

    return change
  }

  /**
   * Убрать ошибочное разовое изменение (C-F16). Раньше отмену занятия, заведённую по
   * ошибке, деканат исправить не мог: студенты получили пуш и видели «отменено». Исправление
   * изменения — это удаление и новое изменение.
   *
   * Группа и преподаватели получают живое обновление; уведомление «изменение отменено» —
   * только если дата ещё не прошла по часам вуза: о вчерашней ошибке писать незачем.
   */
  async removeChange(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const change = await this.prisma.scheduleChange.findUnique({
      where: { id },
      select: CHANGE_SELECT,
    })
    if (!change) {
      throw new AppException('NOT_FOUND', 'Изменение не найдено')
    }
    const gctx = await this.resolveGroupContext(change.pair.groupId)
    this.assertManageScopeForGroup(actor, gctx)

    // deleteMany: параллельное удаление того же изменения — NOT_FOUND, а не 500.
    const { count } = await this.prisma.scheduleChange.deleteMany({ where: { id } })
    if (count === 0) {
      throw new AppException('NOT_FOUND', 'Изменение не найдено')
    }
    const date = change.date.toISOString().slice(0, 10)
    await this.audit.record({
      userId: actor.sub,
      action: 'schedule_change_deleted',
      entity: 'ScheduleChange',
      entityId: id,
      metadata: { pairId: change.pairId, groupId: change.pair.groupId, type: change.type, date },
      ...ctx,
    })

    const { pair } = change
    const teacherId = pair.teacher?.id ?? null
    const newTeacherId = change.newTeacher?.id ?? null
    // Клиенты по событию перечитывают изменения; `removed` — чтобы отличить удаление.
    this.broadcastScheduleChange(pair.groupId, [teacherId, newTeacherId], id, {
      change,
      groupId: pair.groupId,
      removed: true,
    })

    if (date >= localDateString(new Date(), gctx.timezone)) {
      await this.enqueueChangeNotification(
        { id: change.pairId, groupId: pair.groupId, subject: pair.subject, teacherId },
        id,
        {
          date,
          label: CHANGE_REVOKED_LABEL[change.type],
          newTeacherId,
          dedupeKey: `schedule-change-removed:${id}`,
        },
      )
    }
  }

  /**
   * Занятость ресурсов в конкретную дату (C-F16): фактический слот пары после изменения
   * против фактических слотов остальных пар этого дня — с их собственными изменениями на
   * дату (отменённые не мешают, перенесённые — по новому времени, замена — по заменяющему).
   * Кандидаты — пары действующих сеток (и той же версии) того же дня недели, где совпадает
   * группа, преподаватель или аудитория — по шаблону или по изменению на эту дату.
   */
  private async assertNoConflictOnDate(
    tx: Prisma.TransactionClient,
    pair: {
      id: string
      scheduleId: string
      groupId: string
      teacherId: string | null
      roomId: string | null
      dayOfWeek: number
      startTime: string
      endTime: string
      weekType: WeekType
    },
    day: Date,
    changes: DatedChange[],
    type: ScheduleChangeType,
  ): Promise<void> {
    const slot = effectiveSlot(pair, changes)
    if (!slot) return
    const orResource: Prisma.PairWhereInput[] = [{ groupId: pair.groupId }]
    if (slot.teacherId) {
      orResource.push(
        { teacherId: slot.teacherId },
        { changes: { some: { date: day, newTeacherId: slot.teacherId } } },
      )
    }
    if (slot.roomId) {
      orResource.push(
        { roomId: slot.roomId },
        { changes: { some: { date: day, newRoomId: slot.roomId } } },
      )
    }
    const candidates = await tx.pair.findMany({
      where: {
        id: { not: pair.id },
        dayOfWeek: pair.dayOfWeek,
        schedule: { is: { OR: [{ isActive: true }, { id: pair.scheduleId }] } },
        OR: orResource,
      },
      take: PAIR_CONFLICT_LIMIT,
      select: {
        subject: true,
        startTime: true,
        endTime: true,
        weekType: true,
        groupId: true,
        teacherId: true,
        roomId: true,
        changes: {
          where: { date: day },
          select: DATED_CHANGE_SELECT,
          orderBy: { createdAt: 'asc' },
          take: CHANGES_PER_PAIR_DATE_LIMIT,
        },
      },
    })

    const conflicts: { field: string; message: string }[] = []
    for (const c of candidates) {
      if (!weekTypesOverlap(pair.weekType, c.weekType)) continue
      const other = effectiveSlot(c, c.changes)
      if (!other) continue
      if (!timeOverlap(slot.startTime, slot.endTime, other.startTime, other.endTime)) continue
      const at = `${c.subject} (${other.startTime}–${other.endTime})`
      if (c.groupId === pair.groupId) {
        conflicts.push({ field: 'groupId', message: `Группа уже занята: ${at}` })
      }
      if (slot.teacherId && other.teacherId === slot.teacherId) {
        conflicts.push({
          field: type === ScheduleChangeType.SUBSTITUTED ? 'newTeacherId' : 'teacherId',
          message: `Преподаватель уже занят: ${at}`,
        })
      }
      if (slot.roomId && other.roomId === slot.roomId) {
        conflicts.push({
          field: type === ScheduleChangeType.ROOM_CHANGED ? 'newRoomId' : 'roomId',
          message: `Аудитория уже занята: ${at}`,
        })
      }
    }
    if (conflicts.length > 0) {
      throw new AppException(
        'CONFLICT',
        'Конфликт в расписании',
        conflicts.slice(0, CONFLICT_DETAILS_LIMIT),
      )
    }
  }

  /**
   * Живое обновление сетки: `schedule:changed` + конверт `schedule.lesson.updated` в комнату
   * группы и в личные комнаты преподавателей — они в комнату группы не входят.
   */
  private broadcastScheduleChange(
    groupId: string,
    teacherIds: (string | null)[],
    entityId: string,
    payload: Record<string, unknown>,
  ): void {
    this.realtime.emitToRoom(`group:${groupId}`, 'schedule:changed', payload)
    // Параллельно — единый конверт (PR-8/#12); старое событие выше не трогаем.
    this.realtime.emitEventToRoom(`group:${groupId}`, 'schedule.lesson.updated', entityId, payload)
    for (const teacherId of new Set(teacherIds)) {
      if (!teacherId) continue
      this.realtime.emitToUser(teacherId, 'schedule:changed', payload)
      this.realtime.emitEventToUser(teacherId, 'schedule.lesson.updated', entityId, payload)
    }
  }

  async listChanges(viewer: JwtPayload, query: ScheduleChangeQueryInput) {
    const range = { gte: dateOnly(query.from), lte: dateOnly(query.to) }
    const pairWhere = this.changePairScope(viewer, query, range)
    return this.prisma.scheduleChange.findMany({
      where: { date: range, pair: { is: pairWhere } },
      select: CHANGE_SELECT,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    })
  }

  private async enqueueChangeNotification(
    pair: { id: string; groupId: string; subject: string; teacherId: string | null },
    changeId: string,
    notice: { date: string; label: string; newTeacherId: string | null; dedupeKey: string },
  ): Promise<void> {
    const members = await this.prisma.user.findMany({
      where: { groupId: pair.groupId, deletedAt: null },
      select: { id: true },
      take: GROUP_MEMBERS_LIMIT,
    })
    const recipientIds = new Set(members.map((m) => m.id))
    if (pair.teacherId) recipientIds.add(pair.teacherId)
    if (notice.newTeacherId) recipientIds.add(notice.newTeacherId)
    if (recipientIds.size === 0) return

    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      NOTIFICATION_JOBS.SCHEDULE_CHANGED,
      {
        recipientIds: [...recipientIds],
        type: 'SCHEDULE_CHANGE',
        titleKey: 'schedule.changed.title',
        bodyKey: 'schedule.changed.body',
        params: { subject: pair.subject, change: notice.label, date: notice.date },
        data: { pairId: pair.id, changeId, groupId: pair.groupId, date: notice.date },
        // Идемпотентность: одно уведомление на изменение (docs/BACKEND_RULES.md §9.2).
        dedupeKey: notice.dedupeKey,
      },
      { jobId: notice.dedupeKey },
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

  /**
   * Пара даёт преподавателю права «своего занятия»: ростер группы, посещаемость, QR-отметку и
   * предметный чат. Поэтому ставить себе пары он может только в группах, где ведёт дисциплину;
   * иначе любой преподаватель вуза назначал себя в чужую группу и проставлял ей прогулы.
   * Остальные пары расставляет деканат.
   */
  private async assertTeachesGroup(teacherId: string, groupId: string): Promise<void> {
    const course = await this.prisma.course.findFirst({
      where: { teacherId, groupId },
      select: { id: true },
    })
    if (!course) {
      throw new AppException('WRONG_SCOPE', 'Вы не ведёте дисциплин в этой группе')
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
    range: Prisma.DateTimeFilter,
  ): Prisma.PairWhereInput {
    if (viewer.role === Role.STUDENT || viewer.role === Role.STAROSTA) {
      return { groupId: viewer.groupId ?? '__none__' }
    }
    if (viewer.role === Role.TEACHER) {
      // Свои пары + чужие, где он заменяющий в этом периоде (C-F12). По таким парам отдаём все
      // изменения периода, а не только замену на него: отмена той же пары или новая замена
      // другим преподавателем тоже его касаются — клиент берёт последнюю.
      const where: Prisma.PairWhereInput = {
        OR: [
          { teacherId: viewer.sub },
          {
            changes: {
              some: {
                type: ScheduleChangeType.SUBSTITUTED,
                newTeacherId: viewer.sub,
                date: range,
              },
            },
          },
        ],
      }
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
