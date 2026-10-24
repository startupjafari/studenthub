import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { SchedulesService } from './schedules.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { RoomService } from '../rooms/rooms.service'
import type { RealtimeGateway } from '../../common/realtime'
import type { QueueService } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { AppException } from '../../common/exceptions/app.exception'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

function setup() {
  const prisma = {
    pair: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    schedule: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    scheduleChange: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    attendance: { findFirst: jest.fn().mockResolvedValue(null) },
    group: { findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    course: { findFirst: jest.fn().mockResolvedValue({ id: 'c-1' }) },
    user: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    university: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Almaty' }) },
    $transaction: jest.fn(),
    $executeRaw: jest.fn().mockResolvedValue(0),
  }
  // Колбэк-транзакция: в tx — тот же мок.
  prisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : arg,
  )
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const rooms = { assertRoomInUniversity: jest.fn().mockResolvedValue(undefined) }
  const realtime = {
    emitToRoom: jest.fn(),
    emitEventToRoom: jest.fn(),
    emitToUser: jest.fn(),
    emitEventToUser: jest.fn(),
  }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const service = new SchedulesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    rooms as unknown as RoomService,
    realtime as unknown as RealtimeGateway,
    queue as unknown as QueueService,
  )
  return { service, prisma, audit, rooms, realtime, queue }
}

function viewer(role: Role, scope: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: scope.sub ?? 'u',
    role,
    universityId: scope.universityId ?? null,
    facultyId: scope.facultyId ?? null,
    groupId: scope.groupId ?? null,
  }
}

// Назначаемый преподаватель: действующий, своего вуза.
const TEACHER_USER = { universityId: 'uni-1', role: 'TEACHER', isBlocked: false }

// Группа sch-1 → факультет fac-1 → вуз uni-1.
const GROUP_CTX = {
  id: 'grp-1',
  facultyId: 'fac-1',
  faculty: { universityId: 'uni-1', university: { timezone: 'Asia/Almaty' } },
}

function createdPair(over: Record<string, unknown> = {}) {
  return {
    id: 'p-new',
    scheduleId: 'sch-1',
    groupId: 'grp-1',
    subject: 'Матанализ',
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '10:30',
    weekType: 'ODD',
    teacher: null,
    room: null,
    ...over,
  }
}

// ── 6.3 Ролевая выборка ────────────────────────────────────────────────────
describe('SchedulesService.getSchedule — ролевая выборка (6.3)', () => {
  async function whereFor(v: JwtPayload, query = {}) {
    const { service, prisma } = setup()
    await service.getSchedule(v, query as never)
    return prisma.pair.findMany.mock.calls[0][0].where
  }

  it('студент — только своя группа, активное расписание', async () => {
    const where = await whereFor(viewer(Role.STUDENT, { groupId: 'grp-1', universityId: 'uni-1' }))
    expect(where.groupId).toBe('grp-1')
    expect(where.schedule).toEqual({ is: { isActive: true } })
  })

  it('студент без группы не получает чужие пары (groupId = заглушка)', async () => {
    const where = await whereFor(viewer(Role.STUDENT, { groupId: null }))
    expect(where.groupId).toBe('__none__')
  })

  it('преподаватель — свои пары (teacherId = self)', async () => {
    const where = await whereFor(viewer(Role.TEACHER, { sub: 'teacher-1', universityId: 'uni-1' }))
    expect(where.teacherId).toBe('teacher-1')
  })

  it('декан — свой факультет', async () => {
    const where = await whereFor(viewer(Role.DEAN, { facultyId: 'fac-1', universityId: 'uni-1' }))
    expect(where.group).toEqual({ is: { facultyId: 'fac-1' } })
  })

  it('админ вуза — весь свой вуз', async () => {
    const where = await whereFor(viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-1' }))
    expect(where.group).toEqual({ is: { faculty: { is: { universityId: 'uni-1' } } } })
  })

  it('студент не может подменить группу через фильтр groupId', async () => {
    const where = await whereFor(viewer(Role.STUDENT, { groupId: 'grp-1' }), { groupId: 'grp-999' })
    expect(where.groupId).toBe('grp-1')
  })

  it('админ платформы — все вузы, фильтр группы сужает', async () => {
    expect(await whereFor(viewer(Role.PLATFORM_ADMIN))).toEqual({
      schedule: { is: { isActive: true } },
    })
    const where = await whereFor(viewer(Role.PLATFORM_ADMIN), { groupId: 'grp-9' })
    expect(where.groupId).toBe('grp-9')
  })
})

// ── Модератор платформы: «Расписание — чтение» ❌ (docs/PROJECT.md §2.2) ──────
// Раньше read-scope держался на isPlatformRole, и модератор платформы читал расписание всех
// вузов (сетку, разовые изменения, версии с парами), хотя по матрице доступа его у него нет.
describe('SchedulesService — модератору платформы расписание закрыто', () => {
  const moderator = viewer(Role.PLATFORM_MODERATOR)

  async function expectForbidden(run: Promise<unknown>) {
    await expect(run).rejects.toBeInstanceOf(AppException)
    await expect(run).rejects.toMatchObject({ code: 'FORBIDDEN' })
  }

  it('GET /schedule — FORBIDDEN, в базу не ходим (и с фильтром группы)', async () => {
    const { service, prisma } = setup()
    await expectForbidden(service.getSchedule(moderator, {} as never))
    await expectForbidden(service.getSchedule(moderator, { groupId: 'grp-1' } as never))
    expect(prisma.pair.findMany).not.toHaveBeenCalled()
  })

  it('GET /schedule/changes — FORBIDDEN', async () => {
    const { service, prisma } = setup()
    await expectForbidden(
      service.listChanges(moderator, { from: '2026-10-19', to: '2026-10-25' } as never),
    )
    expect(prisma.scheduleChange.findMany).not.toHaveBeenCalled()
  })

  it('GET /schedules и GET /schedules/:id — FORBIDDEN', async () => {
    const { service, prisma } = setup()
    prisma.schedule.findUnique.mockResolvedValue({ id: 'sch-1', groupId: 'grp-1' })
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    await expectForbidden(service.listSchedules(moderator, 'grp-1'))
    await expectForbidden(service.getScheduleById(moderator, 'sch-1'))
    expect(prisma.schedule.findMany).not.toHaveBeenCalled()
    expect(prisma.pair.findMany).not.toHaveBeenCalled()
  })

  it('админ платформы по-прежнему читает версии и изменения любого вуза', async () => {
    const { service, prisma } = setup()
    prisma.schedule.findMany.mockResolvedValue([])
    prisma.schedule.findUnique.mockResolvedValue({ id: 'sch-1', groupId: 'grp-1' })
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    const admin = viewer(Role.PLATFORM_ADMIN)

    await service.listSchedules(admin)
    expect(prisma.schedule.findMany.mock.calls[0][0].where).toEqual({})
    await expect(service.getScheduleById(admin, 'sch-1')).resolves.toBeDefined()
    await service.listChanges(admin, { from: '2026-10-19', to: '2026-10-25' } as never)
    expect(prisma.scheduleChange.findMany.mock.calls[0][0].where.pair).toEqual({ is: {} })
  })
})

describe('SchedulesService — версии расписания преподавателю: только свои группы (§2.2)', () => {
  const teacher = viewer(Role.TEACHER, { sub: 't-1', universityId: 'uni-1' })
  const taught = [
    { courses: { some: { teacherId: 't-1' } } },
    { pairs: { some: { teacherId: 't-1', schedule: { is: { isActive: true } } } } },
  ]

  it('GET /schedules — группы, где он ведёт занятия, а не весь вуз', async () => {
    const { service, prisma } = setup()
    prisma.schedule.findMany.mockResolvedValue([])
    await service.listSchedules(teacher, 'grp-1')
    expect(prisma.schedule.findMany.mock.calls[0][0].where).toEqual({
      group: { is: { faculty: { is: { universityId: 'uni-1' } }, OR: taught } },
      groupId: 'grp-1',
    })
  })

  it('GET /schedules/:id чужой группы → WRONG_SCOPE, пары не читаются', async () => {
    const { service, prisma } = setup()
    prisma.schedule.findUnique.mockResolvedValue({ id: 'sch-1', groupId: 'grp-1' })
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    const err = await service.getScheduleById(teacher, 'sch-1').catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
    expect(prisma.group.findFirst).toHaveBeenCalledWith({
      where: { id: 'grp-1', OR: taught },
      select: { id: true },
    })
    expect(prisma.pair.findMany).not.toHaveBeenCalled()
  })

  it('GET /schedules/:id своей группы → версия с парами', async () => {
    const { service, prisma } = setup()
    prisma.schedule.findUnique.mockResolvedValue({ id: 'sch-1', groupId: 'grp-1' })
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    prisma.group.findFirst.mockResolvedValue({ id: 'grp-1' })
    await expect(service.getScheduleById(teacher, 'sch-1')).resolves.toBeDefined()
  })
})

// ── 6.6 weekType в фильтре чтения ───────────────────────────────────────────
describe('SchedulesService.getSchedule — фильтр чётности недели', () => {
  it('нечётная неделя → пары ODD и BOTH', async () => {
    const { service, prisma } = setup()
    await service.getSchedule(viewer(Role.STUDENT, { groupId: 'grp-1' }), {
      weekType: 'ODD',
    } as never)
    const where = prisma.pair.findMany.mock.calls[0][0].where
    expect(where.weekType).toEqual({ in: ['ODD', 'BOTH'] })
  })

  it('BOTH → без фильтра чётности', async () => {
    const { service, prisma } = setup()
    await service.getSchedule(viewer(Role.STUDENT, { groupId: 'grp-1' }), {
      weekType: 'BOTH',
    } as never)
    const where = prisma.pair.findMany.mock.calls[0][0].where
    expect(where.weekType).toBeUndefined()
  })
})

// ── 6.4 Детектор конфликтов ─────────────────────────────────────────────────
describe('SchedulesService.createPair — детектор конфликтов (6.4)', () => {
  const admin = viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-1' })
  const baseInput = {
    scheduleId: 'sch-1',
    subject: 'Матанализ',
    teacherId: 't-1',
    roomId: 'r-1',
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '10:30',
    weekType: 'ODD' as const,
  }

  function primeCreate(prisma: ReturnType<typeof setup>['prisma']) {
    prisma.schedule.findUnique.mockResolvedValue({ id: 'sch-1', groupId: 'grp-1' })
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    prisma.user.findFirst.mockResolvedValue(TEACHER_USER)
    prisma.pair.create.mockResolvedValue(createdPair())
  }

  it('аудитория занята в пересекающемся слоте → CONFLICT(roomId)', async () => {
    const { service, prisma } = setup()
    primeCreate(prisma)
    prisma.pair.findMany.mockResolvedValue([
      {
        id: 'p2',
        subject: 'Физика',
        startTime: '09:00',
        endTime: '10:00',
        weekType: 'BOTH',
        groupId: 'other',
        teacherId: 'other',
        roomId: 'r-1',
      },
    ])
    const err = await service.createPair(admin, baseInput, ctx).catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('CONFLICT')
    expect(err.details).toEqual([
      { field: 'roomId', message: expect.stringContaining('Аудитория') },
    ])
  })

  it('преподаватель занят → CONFLICT(teacherId)', async () => {
    const { service, prisma } = setup()
    primeCreate(prisma)
    prisma.pair.findMany.mockResolvedValue([
      {
        id: 'p2',
        subject: 'Физика',
        startTime: '09:30',
        endTime: '11:00',
        weekType: 'ODD',
        groupId: 'other',
        teacherId: 't-1',
        roomId: 'other',
      },
    ])
    const err = await service.createPair(admin, baseInput, ctx).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(err.details[0].field).toBe('teacherId')
  })

  it('группа занята → CONFLICT(groupId)', async () => {
    const { service, prisma } = setup()
    primeCreate(prisma)
    prisma.pair.findMany.mockResolvedValue([
      {
        id: 'p2',
        subject: 'Физика',
        startTime: '09:00',
        endTime: '10:00',
        weekType: 'BOTH',
        groupId: 'grp-1',
        teacherId: null,
        roomId: null,
      },
    ])
    const err = await service.createPair(admin, baseInput, ctx).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(err.details[0].field).toBe('groupId')
  })

  it('нет пересечения по времени → пара создаётся', async () => {
    const { service, prisma } = setup()
    primeCreate(prisma)
    prisma.pair.findMany.mockResolvedValue([
      {
        id: 'p2',
        subject: 'Физика',
        startTime: '10:30',
        endTime: '12:00',
        weekType: 'ODD',
        groupId: 'grp-1',
        teacherId: 't-1',
        roomId: 'r-1',
      },
    ])
    const res = await service.createPair(admin, baseInput, ctx)
    expect(res.id).toBe('p-new')
    expect(prisma.pair.create).toHaveBeenCalled()
  })

  it('разная чётность (ODD vs EVEN) в одном слоте → НЕ конфликт', async () => {
    const { service, prisma } = setup()
    primeCreate(prisma)
    prisma.pair.findMany.mockResolvedValue([
      {
        id: 'p2',
        subject: 'Физика',
        startTime: '09:00',
        endTime: '10:00',
        weekType: 'EVEN',
        groupId: 'grp-1',
        teacherId: 't-1',
        roomId: 'r-1',
      },
    ])
    const res = await service.createPair(admin, baseInput, ctx)
    expect(res.id).toBe('p-new')
  })

  it('ODD против BOTH в одном слоте → конфликт', async () => {
    const { service, prisma } = setup()
    primeCreate(prisma)
    prisma.pair.findMany.mockResolvedValue([
      {
        id: 'p2',
        subject: 'Физика',
        startTime: '09:00',
        endTime: '10:00',
        weekType: 'BOTH',
        groupId: 'grp-1',
        teacherId: null,
        roomId: null,
      },
    ])
    const err = await service.createPair(admin, baseInput, ctx).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
  })

  it('чужой вуз (декан другого факультета) → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    primeCreate(prisma)
    const dean = viewer(Role.DEAN, { facultyId: 'fac-OTHER', universityId: 'uni-1' })
    const err = await service.createPair(dean, baseInput, ctx).catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
  })
})

// Пара по вторникам: 2026-09-15 — вторник.
const changedPair = {
  id: 'pair-1',
  scheduleId: 'sch-1',
  groupId: 'grp-1',
  subject: 'Матанализ',
  teacherId: 't-1',
  roomId: 'r-1',
  dayOfWeek: 2,
  startTime: '09:00',
  endTime: '10:30',
  weekType: 'BOTH',
  schedule: { isActive: true },
}

// ── 6.5 Замена → WS + уведомление ───────────────────────────────────────────
describe('SchedulesService.createChange — WS + очередь (6.5)', () => {
  const admin = viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-1' })

  it('пишет БД, шлёт WS schedule:changed в комнату группы и ставит job', async () => {
    const { service, prisma, realtime, queue } = setup()
    prisma.pair.findUnique.mockResolvedValue(changedPair)
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    prisma.scheduleChange.create.mockResolvedValue({
      id: 'chg-1',
      pairId: 'pair-1',
      type: 'CANCELLED',
    })
    prisma.user.findMany.mockResolvedValue([{ id: 's-1' }, { id: 's-2' }])

    // Вторник в будущем: о прошедшей дате уведомление не уходит.
    const res = await service.createChange(
      admin,
      { pairId: 'pair-1', type: 'CANCELLED', date: '2030-09-17' },
      ctx,
    )
    expect(res.id).toBe('chg-1')
    // §10: сохранили до трансляции.
    expect(prisma.scheduleChange.create).toHaveBeenCalled()
    expect(realtime.emitToRoom).toHaveBeenCalledWith('group:grp-1', 'schedule:changed', {
      change: expect.objectContaining({ id: 'chg-1' }),
      groupId: 'grp-1',
    })
    // Уведомление: студенты группы + преподаватель пары, идемпотентный dedupeKey.
    const jobArg = queue.enqueue.mock.calls[0][2]
    expect(new Set(jobArg.recipientIds)).toEqual(new Set(['s-1', 's-2', 't-1']))
    expect(jobArg.type).toBe('SCHEDULE_CHANGE')
    expect(jobArg.dedupeKey).toBe('schedule-changed:chg-1')
  })

  it('прошедшая дата: изменение пишется и транслируется, но уведомления нет', async () => {
    const { service, prisma, realtime, queue } = setup()
    prisma.pair.findUnique.mockResolvedValue(changedPair)
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    prisma.scheduleChange.create.mockResolvedValue({ id: 'chg-1', pairId: 'pair-1' })
    await service.createChange(
      admin,
      { pairId: 'pair-1', type: 'CANCELLED', date: '2020-01-07' },
      ctx,
    )
    expect(prisma.scheduleChange.create).toHaveBeenCalled()
    expect(realtime.emitToRoom).toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('пара черновой версии → VALIDATION_ERROR(pairId), ни записи, ни уведомления', async () => {
    const { service, prisma, queue } = setup()
    prisma.pair.findUnique.mockResolvedValue({ ...changedPair, schedule: { isActive: false } })
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    const err = await service
      .createChange(admin, { pairId: 'pair-1', type: 'CANCELLED', date: '2030-09-17' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.details).toEqual([expect.objectContaining({ field: 'pairId' })])
    expect(prisma.scheduleChange.create).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})

describe('SchedulesService — scope преподавателя (свои пары)', () => {
  const T = 'teacher-1'
  const teacher = viewer(Role.TEACHER, { sub: T, universityId: 'uni-1' })
  const ownInput = {
    scheduleId: 'sch-1',
    subject: 'Матанализ',
    teacherId: T,
    roomId: null,
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '10:30',
    weekType: 'BOTH' as const,
  }
  const ownExisting = {
    id: 'p-1',
    scheduleId: 'sch-1',
    groupId: 'grp-1',
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '10:30',
    weekType: 'BOTH',
    teacherId: T,
    roomId: null,
    schedule: { isActive: true },
  }

  function primeCreate(prisma: ReturnType<typeof setup>['prisma']): void {
    prisma.schedule.findUnique.mockResolvedValue({ id: 'sch-1', groupId: 'grp-1' })
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    prisma.user.findFirst.mockResolvedValue(TEACHER_USER)
    prisma.pair.findMany.mockResolvedValue([])
    prisma.pair.create.mockResolvedValue(createdPair())
  }

  it('создаёт свою пару (teacherId=self) → успех', async () => {
    const { service, prisma } = setup()
    primeCreate(prisma)
    await service.createPair(teacher, ownInput, ctx)
    expect(prisma.pair.create).toHaveBeenCalled()
  })

  it('группа, где он не ведёт дисциплин → WRONG_SCOPE, пара не создаётся', async () => {
    const { service, prisma } = setup()
    primeCreate(prisma)
    prisma.course.findFirst.mockResolvedValue(null)
    const err = await service.createPair(teacher, ownInput, ctx).catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
    expect(prisma.course.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { teacherId: T, groupId: 'grp-1' } }),
    )
    expect(prisma.pair.create).not.toHaveBeenCalled()
  })

  it('пытается создать пару для другого преподавателя → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    primeCreate(prisma)
    const err = await service
      .createPair(teacher, { ...ownInput, teacherId: 'other' }, ctx)
      .catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('WRONG_SCOPE')
    expect(prisma.pair.create).not.toHaveBeenCalled()
  })

  it('преподаватель другого вуза → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    primeCreate(prisma)
    const foreign = viewer(Role.TEACHER, { sub: T, universityId: 'uni-2' })
    const err = await service.createPair(foreign, ownInput, ctx).catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('WRONG_SCOPE')
  })

  it('правит свою пару → успех', async () => {
    const { service, prisma } = setup()
    prisma.pair.findUnique.mockResolvedValue(ownExisting)
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    prisma.user.findFirst.mockResolvedValue(TEACHER_USER)
    prisma.pair.findMany.mockResolvedValue([])
    prisma.pair.update.mockResolvedValue(createdPair())
    await service.updatePair(teacher, 'p-1', { subject: 'Алгебра' }, ctx)
    expect(prisma.pair.update).toHaveBeenCalled()
  })

  it('правит чужую пару → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.pair.findUnique.mockResolvedValue({ ...ownExisting, id: 'p-2', teacherId: 'other' })
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    const err = await service.updatePair(teacher, 'p-2', { subject: 'X' }, ctx).catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('WRONG_SCOPE')
    expect(prisma.pair.update).not.toHaveBeenCalled()
  })

  it('не может переназначить свою пару другому → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.pair.findUnique.mockResolvedValue(ownExisting)
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    const err = await service
      .updatePair(teacher, 'p-1', { teacherId: 'other' }, ctx)
      .catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('WRONG_SCOPE')
  })

  it('удаляет свою пару → успех; чужую → WRONG_SCOPE', async () => {
    const ok = setup()
    ok.prisma.pair.findUnique.mockResolvedValue({
      id: 'p-1',
      groupId: 'grp-1',
      teacherId: T,
      schedule: { isActive: true },
    })
    ok.prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    ok.prisma.pair.delete.mockResolvedValue({})
    await ok.service.removePair(teacher, 'p-1', ctx)
    expect(ok.prisma.pair.delete).toHaveBeenCalled()

    const bad = setup()
    bad.prisma.pair.findUnique.mockResolvedValue({
      id: 'p-2',
      groupId: 'grp-1',
      teacherId: 'other',
    })
    bad.prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    const err = await bad.service.removePair(teacher, 'p-2', ctx).catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('WRONG_SCOPE')
    expect(bad.prisma.pair.delete).not.toHaveBeenCalled()
  })
})

// ── C-F11: удаление пары/версии не стирает посещаемость ────────────────────
describe('SchedulesService — удаление при наличии посещаемости (C-F11)', () => {
  const dean = viewer(Role.DEAN, { facultyId: 'fac-1', universityId: 'uni-1' })
  const fkError = new Prisma.PrismaClientKnownRequestError('fk', {
    code: 'P2003',
    clientVersion: '6',
  })

  function primePair(prisma: ReturnType<typeof setup>['prisma']): void {
    prisma.pair.findUnique.mockResolvedValue({
      id: 'p-1',
      groupId: 'grp-1',
      teacherId: null,
      schedule: { isActive: true },
    })
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
  }

  function primeSchedule(prisma: ReturnType<typeof setup>['prisma']): void {
    prisma.schedule.findUnique.mockResolvedValue({ id: 'sch-1', groupId: 'grp-1' })
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
  }

  it('пара с отметками → CONFLICT (attendance), пара не удаляется, аудита нет', async () => {
    const { service, prisma, audit } = setup()
    primePair(prisma)
    prisma.attendance.findFirst.mockResolvedValue({ id: 'a-1' })
    const err = await service.removePair(dean, 'p-1', ctx).catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('CONFLICT')
    expect(err.details).toEqual([expect.objectContaining({ field: 'attendance' })])
    expect(prisma.attendance.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pairId: 'p-1' } }),
    )
    expect(prisma.pair.delete).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('пара без отметок → удаляется', async () => {
    const { service, prisma, audit } = setup()
    primePair(prisma)
    prisma.pair.delete.mockResolvedValue({})
    await service.removePair(dean, 'p-1', ctx)
    expect(prisma.pair.delete).toHaveBeenCalledWith({ where: { id: 'p-1' } })
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'pair_deleted' }))
  })

  it('отметка появилась между проверкой и удалением (FK Restrict, P2003) → CONFLICT', async () => {
    const { service, prisma } = setup()
    primePair(prisma)
    prisma.pair.delete.mockRejectedValue(fkError)
    const err = await service.removePair(dean, 'p-1', ctx).catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('CONFLICT')
  })

  it('версия расписания с отметками по парам → CONFLICT, версия не удаляется', async () => {
    const { service, prisma } = setup()
    primeSchedule(prisma)
    prisma.attendance.findFirst.mockResolvedValue({ id: 'a-1' })
    const err = await service.removeSchedule(dean, 'sch-1', ctx).catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('CONFLICT')
    expect(prisma.attendance.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pair: { is: { scheduleId: 'sch-1' } } } }),
    )
    expect(prisma.schedule.delete).not.toHaveBeenCalled()
  })

  it('версия без отметок → удаляется', async () => {
    const { service, prisma } = setup()
    primeSchedule(prisma)
    prisma.schedule.delete.mockResolvedValue({})
    await service.removeSchedule(dean, 'sch-1', ctx)
    expect(prisma.schedule.delete).toHaveBeenCalledWith({ where: { id: 'sch-1' } })
  })

  it('версия: P2003 при удалении → CONFLICT', async () => {
    const { service, prisma } = setup()
    primeSchedule(prisma)
    prisma.schedule.delete.mockRejectedValue(fkError)
    const err = await service.removeSchedule(dean, 'sch-1', ctx).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
  })
})

// ── C-F12: замена доходит до заменяющего ───────────────────────────────────
describe('SchedulesService — замена преподавателя (C-F12)', () => {
  const admin = viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-1' })
  const SUB = 'teacher-sub'
  const substitute = viewer(Role.TEACHER, { sub: SUB, universityId: 'uni-1' })

  it('замена: WS schedule:changed уходит и основному, и заменяющему в личные комнаты', async () => {
    const { service, prisma, realtime } = setup()
    prisma.pair.findUnique.mockResolvedValue(changedPair)
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    prisma.user.findFirst.mockResolvedValue(TEACHER_USER)
    prisma.scheduleChange.create.mockResolvedValue({ id: 'chg-1', pairId: 'pair-1' })

    await service.createChange(
      admin,
      { pairId: 'pair-1', type: 'SUBSTITUTED', date: '2026-09-15', newTeacherId: SUB },
      ctx,
    )
    const payload = { change: expect.objectContaining({ id: 'chg-1' }), groupId: 'grp-1' }
    expect(realtime.emitToRoom).toHaveBeenCalledWith('group:grp-1', 'schedule:changed', payload)
    expect(realtime.emitToUser).toHaveBeenCalledWith('t-1', 'schedule:changed', payload)
    expect(realtime.emitToUser).toHaveBeenCalledWith(SUB, 'schedule:changed', payload)
    expect(realtime.emitEventToUser).toHaveBeenCalledWith(
      SUB,
      'schedule.lesson.updated',
      'chg-1',
      payload,
    )
  })

  it('изменения: преподавателю — свои пары и пары, где он заменяющий в периоде', async () => {
    const { service, prisma } = setup()
    await service.listChanges(substitute, { from: '2026-09-14', to: '2026-09-20' })
    const where = prisma.scheduleChange.findMany.mock.calls[0][0].where
    const range = {
      gte: new Date('2026-09-14T00:00:00.000Z'),
      lte: new Date('2026-09-20T00:00:00.000Z'),
    }
    expect(where.date).toEqual(range)
    expect(where.pair.is.OR).toEqual([
      { teacherId: SUB },
      { changes: { some: { type: 'SUBSTITUTED', newTeacherId: SUB, date: range } } },
    ])
  })

  it('пары по замене на дату: решает последняя замена пары', async () => {
    const { service, prisma } = setup()
    prisma.scheduleChange.findMany.mockResolvedValue([
      // pair-1: замена на него — его пара на этот день.
      {
        pairId: 'pair-1',
        newTeacherId: SUB,
        pair: createdPair({ id: 'pair-1', teacher: { id: 't-1', firstName: 'А', lastName: 'Б' } }),
      },
      // pair-2: сначала на него, потом деканат переназначил на другого — уже не его.
      { pairId: 'pair-2', newTeacherId: SUB, pair: createdPair({ id: 'pair-2' }) },
      { pairId: 'pair-2', newTeacherId: 'other', pair: createdPair({ id: 'pair-2' }) },
    ])
    const pairs = await service.substitutionPairs(substitute, '2026-09-15')
    expect(pairs.map((p) => p.id)).toEqual(['pair-1'])
    const args = prisma.scheduleChange.findMany.mock.calls[0][0]
    expect(args.where.date).toEqual(new Date('2026-09-15T00:00:00.000Z'))
    expect(args.where.pair.is.schedule).toEqual({ is: { isActive: true } })
    expect(args.orderBy).toEqual({ createdAt: 'asc' })
  })

  it('пары по замене — только для преподавателя', async () => {
    const { service, prisma } = setup()
    expect(await service.substitutionPairs(admin, '2026-09-15')).toEqual([])
    expect(prisma.scheduleChange.findMany).not.toHaveBeenCalled()
  })
})

// ── C-F13: активация версии перепроверяет конфликты ────────────────────────
describe('SchedulesService.updateSchedule — активация версии (C-F13)', () => {
  const dean = viewer(Role.DEAN, { facultyId: 'fac-1', universityId: 'uni-1' })
  const draftPair = {
    subject: 'Матанализ',
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '10:30',
    weekType: 'BOTH',
    teacherId: 't-1',
    roomId: 'r-1',
  }

  function prime(prisma: ReturnType<typeof setup>['prisma'], isActive = false): void {
    prisma.schedule.findUnique.mockResolvedValue({ id: 'sch-2', groupId: 'grp-1', isActive })
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma))
    prisma.schedule.update.mockResolvedValue({ id: 'sch-2', isActive: true })
  }

  it('аудитория занята активной сеткой другой группы → CONFLICT с details, версия не активируется', async () => {
    const { service, prisma } = setup()
    prime(prisma)
    prisma.pair.findMany
      .mockResolvedValueOnce([draftPair])
      .mockResolvedValueOnce([
        { ...draftPair, subject: 'Физика', startTime: '10:00', endTime: '11:30', teacherId: 't-9' },
      ])
    const err = await service.updateSchedule(dean, 'sch-2', { isActive: true }, ctx).catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('CONFLICT')
    expect(err.details).toEqual([expect.objectContaining({ field: 'roomId' })])
    expect(prisma.schedule.updateMany).not.toHaveBeenCalled()
    expect(prisma.schedule.update).not.toHaveBeenCalled()
    // Кандидаты — только активные сетки ДРУГИХ групп: своя действующая версия гаснет.
    const candidatesWhere = prisma.pair.findMany.mock.calls[1][0].where
    expect(candidatesWhere.groupId).toEqual({ not: 'grp-1' })
    expect(candidatesWhere.schedule).toEqual({ is: { isActive: true } })
  })

  it('без пересечений → версия активируется, прежняя гаснет', async () => {
    const { service, prisma } = setup()
    prime(prisma)
    prisma.pair.findMany
      .mockResolvedValueOnce([draftPair])
      .mockResolvedValueOnce([{ ...draftPair, startTime: '11:00', endTime: '12:30' }])
    await service.updateSchedule(dean, 'sch-2', { isActive: true }, ctx)
    expect(prisma.schedule.updateMany).toHaveBeenCalled()
    expect(prisma.schedule.update).toHaveBeenCalled()
  })

  it('уже активная версия (переименование) — без перепроверки', async () => {
    const { service, prisma } = setup()
    prime(prisma, true)
    await service.updateSchedule(dean, 'sch-2', { name: 'Весна', isActive: true }, ctx)
    expect(prisma.pair.findMany).not.toHaveBeenCalled()
    expect(prisma.schedule.update).toHaveBeenCalled()
  })
})

// ── C-F16: разовые изменения — проверки, отмена изменения, живые обновления ────
describe('SchedulesService — разовые изменения (C-F16)', () => {
  const admin = viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-1' })

  function prime() {
    const env = setup()
    env.prisma.pair.findUnique.mockResolvedValue(changedPair)
    env.prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    env.prisma.user.findFirst.mockResolvedValue(TEACHER_USER)
    env.prisma.scheduleChange.create.mockResolvedValue({ id: 'chg-1', pairId: 'pair-1' })
    return env
  }

  // Пара другой группы того же дня, по умолчанию 09:30–11:00, преподаватель t-9, ауд. r-9.
  function otherPair(over: Record<string, unknown> = {}) {
    return {
      subject: 'Физика',
      startTime: '09:30',
      endTime: '11:00',
      weekType: 'BOTH',
      groupId: 'grp-2',
      teacherId: 't-9',
      roomId: 'r-9',
      changes: [],
      ...over,
    }
  }

  it('дата не в день пары → VALIDATION_ERROR(date), изменение не создаётся', async () => {
    const { service, prisma, queue } = prime()
    const err = await service
      .createChange(admin, { pairId: 'pair-1', type: 'CANCELLED', date: '2026-09-16' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.details).toEqual([expect.objectContaining({ field: 'date' })])
    expect(prisma.scheduleChange.create).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('дата на неделе другой чётности → VALIDATION_ERROR(date), уведомления нет', async () => {
    const { service, prisma, queue } = prime()
    prisma.pair.findUnique.mockResolvedValue({ ...changedPair, weekType: 'ODD' })
    // 15.09.2026 — 38-я ISO-неделя, чётная.
    const err = await service
      .createChange(admin, { pairId: 'pair-1', type: 'CANCELLED', date: '2026-09-15' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.details).toEqual([expect.objectContaining({ field: 'date' })])
    expect(prisma.scheduleChange.create).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('пара другой чётности в эту дату не проводится и не мешает переносу', async () => {
    const { service, prisma } = prime()
    // Чётная неделя: пара ODD той же группы в это время в эту дату не идёт.
    prisma.pair.findMany.mockResolvedValue([otherPair({ groupId: 'grp-1', weekType: 'ODD' })])
    await service.createChange(
      admin,
      {
        pairId: 'pair-1',
        type: 'MOVED',
        date: '2026-09-15',
        newStartTime: '10:00',
        newEndTime: '11:30',
      },
      ctx,
    )
    expect(prisma.scheduleChange.create).toHaveBeenCalled()
  })

  it('вторая отмена на ту же дату → CONFLICT, без второго уведомления', async () => {
    const { service, prisma, queue } = prime()
    prisma.scheduleChange.findMany.mockResolvedValue([{ type: 'CANCELLED' }])
    const err = await service
      .createChange(admin, { pairId: 'pair-1', type: 'CANCELLED', date: '2026-09-15' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(prisma.$executeRaw).toHaveBeenCalled()
    expect(prisma.scheduleChange.create).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('перенос отменённого занятия → CONFLICT', async () => {
    const { service, prisma } = prime()
    prisma.scheduleChange.findMany.mockResolvedValue([{ type: 'CANCELLED' }])
    const err = await service
      .createChange(
        admin,
        {
          pairId: 'pair-1',
          type: 'MOVED',
          date: '2026-09-15',
          newStartTime: '12:00',
          newEndTime: '13:30',
        },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(prisma.scheduleChange.create).not.toHaveBeenCalled()
  })

  it('замена на преподавателя, занятого в это время → CONFLICT(newTeacherId)', async () => {
    const { service, prisma } = prime()
    prisma.pair.findMany.mockResolvedValue([otherPair()])
    const err = await service
      .createChange(
        admin,
        { pairId: 'pair-1', type: 'SUBSTITUTED', date: '2026-09-15', newTeacherId: 't-9' },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(err.details).toEqual([expect.objectContaining({ field: 'newTeacherId' })])
    expect(prisma.scheduleChange.create).not.toHaveBeenCalled()
    // Кандидаты — тот же день недели, действующие сетки; заменяющий — и по шаблону, и по
    // заменам на эту дату.
    const where = prisma.pair.findMany.mock.calls[0][0].where
    expect(where.dayOfWeek).toBe(2)
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { teacherId: 't-9' },
        {
          changes: {
            some: { date: new Date('2026-09-15T00:00:00.000Z'), newTeacherId: 't-9' },
          },
        },
      ]),
    )
  })

  it('аудиторию на эту дату уже заняла чужая смена аудитории → CONFLICT(newRoomId)', async () => {
    const { service, prisma } = prime()
    prisma.pair.findMany.mockResolvedValue([
      otherPair({
        roomId: 'r-5',
        changes: [
          {
            type: 'ROOM_CHANGED',
            newRoomId: 'r-7',
            newTeacherId: null,
            newStartTime: null,
            newEndTime: null,
          },
        ],
      }),
    ])
    const err = await service
      .createChange(
        admin,
        { pairId: 'pair-1', type: 'ROOM_CHANGED', date: '2026-09-15', newRoomId: 'r-7' },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(err.details).toEqual([expect.objectContaining({ field: 'newRoomId' })])
  })

  it('поля чужого типа отбрасываются: смена аудитории не уносит заменяющего', async () => {
    const { service, prisma, queue } = prime()
    prisma.user.findMany.mockResolvedValue([{ id: 's-1' }])
    await service.createChange(
      admin,
      {
        pairId: 'pair-1',
        type: 'ROOM_CHANGED',
        date: '2026-09-15',
        newRoomId: 'r-7',
        newTeacherId: 't-x',
        newStartTime: '12:00',
        newEndTime: '13:30',
      },
      ctx,
    )
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
    expect(prisma.scheduleChange.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        newRoomId: 'r-7',
        newTeacherId: null,
        newStartTime: null,
        newEndTime: null,
      }),
    )
    for (const [, , job] of queue.enqueue.mock.calls) {
      expect(job.recipientIds).not.toContain('t-x')
    }
  })

  it('перенос с новой аудиторией проверяет занятость новой аудитории', async () => {
    const { service, prisma } = prime()
    prisma.pair.findMany.mockResolvedValue([otherPair({ roomId: 'r-7' })])
    const err = await service
      .createChange(
        admin,
        {
          pairId: 'pair-1',
          type: 'MOVED',
          date: '2026-09-15',
          newStartTime: '10:00',
          newEndTime: '11:30',
          newRoomId: 'r-7',
        },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(err.details).toEqual([expect.objectContaining({ field: 'roomId' })])
    expect(prisma.scheduleChange.create).not.toHaveBeenCalled()
  })

  it('пара, отменённая на эту дату, место не занимает — перенос проходит', async () => {
    const { service, prisma } = prime()
    prisma.pair.findMany.mockResolvedValue([
      otherPair({
        groupId: 'grp-1',
        changes: [
          {
            type: 'CANCELLED',
            newRoomId: null,
            newTeacherId: null,
            newStartTime: null,
            newEndTime: null,
          },
        ],
      }),
    ])
    await service.createChange(
      admin,
      {
        pairId: 'pair-1',
        type: 'MOVED',
        date: '2026-09-15',
        newStartTime: '10:00',
        newEndTime: '11:30',
      },
      ctx,
    )
    expect(prisma.scheduleChange.create).toHaveBeenCalled()
  })

  it('перенос в время, где группа уже на другой паре → CONFLICT(groupId)', async () => {
    const { service, prisma } = prime()
    prisma.pair.findMany.mockResolvedValue([
      otherPair({
        groupId: 'grp-1',
        teacherId: 't-3',
        roomId: 'r-3',
        startTime: '11:00',
        endTime: '12:30',
      }),
    ])
    const err = await service
      .createChange(
        admin,
        {
          pairId: 'pair-1',
          type: 'MOVED',
          date: '2026-09-15',
          newStartTime: '11:30',
          newEndTime: '13:00',
        },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(err.details).toEqual([expect.objectContaining({ field: 'groupId' })])
  })

  describe('removeChange', () => {
    function stored(date: string) {
      return {
        id: 'chg-1',
        pairId: 'pair-1',
        type: 'CANCELLED',
        date: new Date(`${date}T00:00:00.000Z`),
        newTeacher: null,
        newRoom: null,
        pair: {
          scheduleId: 'sch-1',
          groupId: 'grp-1',
          subject: 'Матанализ',
          dayOfWeek: 6,
          startTime: '10:00',
          endTime: '11:30',
          weekType: 'BOTH',
          teacher: { id: 't-1', firstName: 'А', lastName: 'Б' },
          room: { id: 'r-1', name: '101' },
        },
      }
    }

    it('будущая дата: удаляет, пишет аудит, шлёт WS и уведомление «занятие состоится»', async () => {
      const { service, prisma, realtime, queue, audit } = setup()
      prisma.scheduleChange.findUnique.mockResolvedValue(stored('2999-01-05'))
      prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
      prisma.user.findMany.mockResolvedValue([{ id: 's-1' }])
      await service.removeChange(admin, 'chg-1', ctx)
      expect(prisma.scheduleChange.deleteMany).toHaveBeenCalledWith({ where: { id: 'chg-1' } })
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'schedule_change_deleted', entityId: 'chg-1' }),
      )
      const payload = expect.objectContaining({ groupId: 'grp-1', removed: true })
      expect(realtime.emitToRoom).toHaveBeenCalledWith('group:grp-1', 'schedule:changed', payload)
      expect(realtime.emitToUser).toHaveBeenCalledWith('t-1', 'schedule:changed', payload)
      const job = queue.enqueue.mock.calls[0][2]
      expect(job.dedupeKey).toBe('schedule-change-removed:chg-1')
      expect(job.params.change).toBe('занятие состоится')
      expect(new Set(job.recipientIds)).toEqual(new Set(['s-1', 't-1']))
    })

    it('прошедшая дата: удаляет и обновляет сетку, но уведомление не шлёт', async () => {
      const { service, prisma, realtime, queue } = setup()
      prisma.scheduleChange.findUnique.mockResolvedValue(stored('2020-01-06'))
      prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
      await service.removeChange(admin, 'chg-1', ctx)
      expect(prisma.scheduleChange.deleteMany).toHaveBeenCalled()
      expect(realtime.emitToRoom).toHaveBeenCalled()
      expect(queue.enqueue).not.toHaveBeenCalled()
      // Прошедшую дату не перепроверяем: история не переигрывается.
      expect(prisma.pair.findMany).not.toHaveBeenCalled()
    })

    it('будущая дата: слот, куда возвращается пара, уже занят → CONFLICT, изменение остаётся', async () => {
      const { service, prisma, queue } = setup()
      prisma.scheduleChange.findUnique.mockResolvedValue(stored('2999-01-05'))
      prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
      // В освободившуюся 101 на 10:00 уже поставили пару другой группы.
      prisma.pair.findMany.mockResolvedValue([
        {
          subject: 'Физика',
          startTime: '10:00',
          endTime: '11:00',
          weekType: 'BOTH',
          groupId: 'grp-2',
          teacherId: 't-9',
          roomId: 'r-1',
          changes: [],
        },
      ])
      const err = await service.removeChange(admin, 'chg-1', ctx).catch((e) => e)
      expect(err.code).toBe('CONFLICT')
      expect(err.details).toEqual([expect.objectContaining({ field: 'roomId' })])
      expect(prisma.$executeRaw.mock.calls[0].slice(1)).toEqual(['schedule-slot:uni-1:6'])
      expect(prisma.scheduleChange.deleteMany).not.toHaveBeenCalled()
      expect(queue.enqueue).not.toHaveBeenCalled()
    })

    it('декан чужого факультета → WRONG_SCOPE, ничего не удаляется', async () => {
      const { service, prisma } = setup()
      prisma.scheduleChange.findUnique.mockResolvedValue(stored('2999-01-05'))
      prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
      const dean = viewer(Role.DEAN, { facultyId: 'fac-2', universityId: 'uni-1' })
      const err = await service.removeChange(dean, 'chg-1', ctx).catch((e) => e)
      expect(err.code).toBe('WRONG_SCOPE')
      expect(prisma.scheduleChange.deleteMany).not.toHaveBeenCalled()
    })

    it('уже удалено параллельно → NOT_FOUND', async () => {
      const { service, prisma } = setup()
      prisma.scheduleChange.findUnique.mockResolvedValue(stored('2999-01-05'))
      prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
      prisma.scheduleChange.deleteMany.mockResolvedValue({ count: 0 })
      const err = await service.removeChange(admin, 'chg-1', ctx).catch((e) => e)
      expect(err.code).toBe('NOT_FOUND')
    })
  })

  describe('правка и удаление пары — живое обновление', () => {
    const dean = viewer(Role.DEAN, { facultyId: 'fac-1', universityId: 'uni-1' })
    const existing = {
      id: 'p-1',
      scheduleId: 'sch-1',
      groupId: 'grp-1',
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '10:30',
      weekType: 'BOTH',
      teacherId: 't-1',
      roomId: null,
      schedule: { isActive: true },
    }

    it('смена преподавателя пары действующей сетки: группе и обоим преподавателям', async () => {
      const { service, prisma, realtime } = setup()
      prisma.pair.findUnique.mockResolvedValue(existing)
      prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
      prisma.user.findFirst.mockResolvedValue(TEACHER_USER)
      prisma.pair.update.mockResolvedValue(createdPair({ id: 'p-1' }))
      await service.updatePair(dean, 'p-1', { teacherId: 't-2' }, ctx)
      const payload = { change: null, groupId: 'grp-1', pairId: 'p-1' }
      expect(realtime.emitToRoom).toHaveBeenCalledWith('group:grp-1', 'schedule:changed', payload)
      expect(realtime.emitToUser).toHaveBeenCalledWith('t-1', 'schedule:changed', payload)
      expect(realtime.emitToUser).toHaveBeenCalledWith('t-2', 'schedule:changed', payload)
    })

    it('черновик версии: правка без трансляции', async () => {
      const { service, prisma, realtime } = setup()
      prisma.pair.findUnique.mockResolvedValue({ ...existing, schedule: { isActive: false } })
      prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
      prisma.user.findFirst.mockResolvedValue(TEACHER_USER)
      prisma.pair.update.mockResolvedValue(createdPair({ id: 'p-1' }))
      await service.updatePair(dean, 'p-1', { subject: 'Алгебра' }, ctx)
      expect(realtime.emitToRoom).not.toHaveBeenCalled()
    })

    it('удаление пары действующей сетки: событие с removed', async () => {
      const { service, prisma, realtime } = setup()
      prisma.pair.findUnique.mockResolvedValue(existing)
      prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
      prisma.pair.delete.mockResolvedValue({})
      await service.removePair(dean, 'p-1', ctx)
      expect(realtime.emitToUser).toHaveBeenCalledWith('t-1', 'schedule:changed', {
        change: null,
        groupId: 'grp-1',
        pairId: 'p-1',
        removed: true,
      })
    })
  })
})

// ── C-F27: кого можно назначить, гонка конфликтов, черновик рядом с действующей версией ──
// Порядковый номер i-го вызова мока среди всех моков теста (не было вызова — Infinity).
function callOrder(mock: jest.Mock, i = 0): number {
  return mock.mock.invocationCallOrder[i] ?? Infinity
}

describe('SchedulesService — назначение преподавателя и проверки сетки (C-F27)', () => {
  const dean = viewer(Role.DEAN, { facultyId: 'fac-1', universityId: 'uni-1' })
  const input = {
    scheduleId: 'sch-1',
    subject: 'Матанализ',
    teacherId: 't-1',
    roomId: 'r-1',
    dayOfWeek: 3,
    startTime: '09:00',
    endTime: '10:30',
    weekType: 'BOTH' as const,
  }

  function primeCreate(prisma: ReturnType<typeof setup>['prisma']): void {
    prisma.schedule.findUnique.mockResolvedValue({ id: 'sch-1', groupId: 'grp-1' })
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    prisma.user.findFirst.mockResolvedValue(TEACHER_USER)
    prisma.pair.create.mockResolvedValue(createdPair())
  }

  it('преподавателем пары нельзя поставить студента → VALIDATION_ERROR(teacherId)', async () => {
    const { service, prisma } = setup()
    primeCreate(prisma)
    prisma.user.findFirst.mockResolvedValue({ ...TEACHER_USER, role: 'STUDENT' })
    const err = await service.createPair(dean, input, ctx).catch((e) => e)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.details).toEqual([expect.objectContaining({ field: 'teacherId' })])
    expect(prisma.pair.create).not.toHaveBeenCalled()
  })

  it('заблокированного преподавателя назначить нельзя', async () => {
    const { service, prisma } = setup()
    primeCreate(prisma)
    prisma.user.findFirst.mockResolvedValue({ ...TEACHER_USER, isBlocked: true })
    const err = await service.createPair(dean, input, ctx).catch((e) => e)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(prisma.pair.create).not.toHaveBeenCalled()
  })

  it('декан может вести пару', async () => {
    const { service, prisma } = setup()
    primeCreate(prisma)
    prisma.user.findFirst.mockResolvedValue({ ...TEACHER_USER, role: 'DEAN' })
    await service.createPair(dean, input, ctx)
    expect(prisma.pair.create).toHaveBeenCalled()
  })

  it('заменяющим нельзя поставить студента → VALIDATION_ERROR(newTeacherId)', async () => {
    const { service, prisma } = setup()
    prisma.pair.findUnique.mockResolvedValue(changedPair)
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    prisma.user.findFirst.mockResolvedValue({ ...TEACHER_USER, role: 'STUDENT' })
    const err = await service
      .createChange(
        dean,
        { pairId: 'pair-1', type: 'SUBSTITUTED', date: '2026-09-15', newTeacherId: 's-1' },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.details).toEqual([expect.objectContaining({ field: 'newTeacherId' })])
    expect(prisma.scheduleChange.create).not.toHaveBeenCalled()
  })

  it('проверка и запись пары — в транзакции под локом дня вуза', async () => {
    const { service, prisma } = setup()
    primeCreate(prisma)
    await service.createPair(dean, input, ctx)
    expect(prisma.$transaction).toHaveBeenCalled()
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    const lockKey = prisma.$executeRaw.mock.calls[0].slice(1)
    expect(lockKey).toEqual(['schedule-slot:uni-1:3'])
    // Лок — до поиска конфликтов, запись — после.
    expect(callOrder(prisma.$executeRaw)).toBeLessThan(callOrder(prisma.pair.findMany))
    expect(callOrder(prisma.pair.findMany)).toBeLessThan(callOrder(prisma.pair.create))
  })

  it('чужая пара, перенесённая на будущую дату в ту же аудиторию и время → CONFLICT', async () => {
    const { service, prisma } = setup()
    primeCreate(prisma)
    // Среда 09.01.2999: пару другой группы из 101 перенесли с 14:00 на 09:00.
    const date = new Date('2999-01-09T00:00:00.000Z')
    prisma.scheduleChange.findMany.mockResolvedValue([{ pairId: 'p-9', date }])
    prisma.pair.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'p-9',
        subject: 'Физика',
        dayOfWeek: 3,
        startTime: '14:00',
        endTime: '15:30',
        weekType: 'BOTH',
        groupId: 'grp-2',
        teacherId: 't-9',
        roomId: 'r-1',
        changes: [
          {
            type: 'MOVED',
            newStartTime: '09:00',
            newEndTime: '10:30',
            newTeacherId: null,
            newRoomId: null,
            date,
          },
        ],
      },
    ])
    const err = await service.createPair(dean, input, ctx).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(err.details).toEqual([
      { field: 'roomId', message: expect.stringContaining('09.01 09:00–10:30') },
    ])
    expect(prisma.pair.create).not.toHaveBeenCalled()
  })

  it('разовое изменение — под тем же локом дня вуза, что и правка шаблона', async () => {
    const { service, prisma } = setup()
    prisma.pair.findUnique.mockResolvedValue(changedPair)
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    prisma.scheduleChange.create.mockResolvedValue({ id: 'chg-1', pairId: 'pair-1' })
    await service.createChange(
      dean,
      { pairId: 'pair-1', type: 'CANCELLED', date: '2030-09-17' },
      ctx,
    )
    expect(prisma.$executeRaw.mock.calls[0].slice(1)).toEqual(['schedule-slot:uni-1:2'])
  })

  it('черновик не конфликтует с действующей версией своей группы, но видит чужие сетки', async () => {
    const { service, prisma } = setup()
    primeCreate(prisma)
    await service.createPair(dean, input, ctx)
    const where = prisma.pair.findMany.mock.calls[0][0].where
    expect(where.schedule).toEqual({
      is: { OR: [{ isActive: true, groupId: { not: 'grp-1' } }, { id: 'sch-1' }] },
    })
    expect(where.OR).toEqual([{ groupId: 'grp-1' }, { teacherId: 't-1' }, { roomId: 'r-1' }])
  })

  describe('правка пары', () => {
    const T = 'teacher-1'
    const teacher = viewer(Role.TEACHER, { sub: T, universityId: 'uni-1' })
    const own = {
      id: 'p-1',
      scheduleId: 'sch-1',
      groupId: 'grp-1',
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '10:30',
      weekType: 'BOTH',
      teacherId: T,
      roomId: null,
      schedule: { isActive: false },
    }

    it('преподаватель не переносит пару в группе, где не ведёт дисциплин → WRONG_SCOPE', async () => {
      const { service, prisma } = setup()
      prisma.pair.findUnique.mockResolvedValue(own)
      prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
      prisma.course.findFirst.mockResolvedValue(null)
      const err = await service
        .updatePair(teacher, 'p-1', { startTime: '11:00', endTime: '12:30' }, ctx)
        .catch((e) => e)
      expect(err.code).toBe('WRONG_SCOPE')
      expect(prisma.course.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { teacherId: T, groupId: 'grp-1' } }),
      )
      expect(prisma.pair.update).not.toHaveBeenCalled()
    })

    it('прежний преподаватель не перепроверяется: его блокировка не мешает переносу', async () => {
      const { service, prisma } = setup()
      prisma.pair.findUnique.mockResolvedValue({ ...own, teacherId: 't-blocked' })
      prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
      prisma.pair.update.mockResolvedValue(createdPair({ id: 'p-1' }))
      await service.updatePair(dean, 'p-1', { dayOfWeek: 4 }, ctx)
      expect(prisma.user.findFirst).not.toHaveBeenCalled()
      expect(prisma.$executeRaw.mock.calls[0].slice(1)).toEqual(['schedule-slot:uni-1:4'])
      expect(prisma.pair.update).toHaveBeenCalled()
    })

    it('новый преподаватель-студент → VALIDATION_ERROR, пара не меняется', async () => {
      const { service, prisma } = setup()
      prisma.pair.findUnique.mockResolvedValue(own)
      prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
      prisma.user.findFirst.mockResolvedValue({ ...TEACHER_USER, role: 'STUDENT' })
      const err = await service.updatePair(dean, 'p-1', { teacherId: 's-1' }, ctx).catch((e) => e)
      expect(err.code).toBe('VALIDATION_ERROR')
      expect(prisma.pair.update).not.toHaveBeenCalled()
    })
  })

  it('активация версии: проверка под локом всех дней вуза, до включения', async () => {
    const { service, prisma } = setup()
    prisma.schedule.findUnique.mockResolvedValue({ id: 'sch-2', groupId: 'grp-1', isActive: false })
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    prisma.schedule.update.mockResolvedValue({ id: 'sch-2', isActive: true })
    prisma.pair.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    await service.updateSchedule(dean, 'sch-2', { isActive: true }, ctx)
    const keys = prisma.$executeRaw.mock.calls.map((c: unknown[]) => c[1])
    expect(keys).toEqual([
      'schedule-active:grp-1',
      ...[1, 2, 3, 4, 5, 6, 7].map((d) => `schedule-slot:uni-1:${d}`),
    ])
    expect(callOrder(prisma.$executeRaw, 7)).toBeLessThan(callOrder(prisma.schedule.updateMany))
  })

  it('создание активной версии — под локом активной версии группы, до гашения прежней', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    prisma.schedule.create.mockResolvedValue({ id: 'sch-3', isActive: true })
    await service.createSchedule(dean, { groupId: 'grp-1', name: 'Весна' }, ctx)
    expect(prisma.$executeRaw.mock.calls[0].slice(1)).toEqual(['schedule-active:grp-1'])
    expect(callOrder(prisma.$executeRaw)).toBeLessThan(callOrder(prisma.schedule.updateMany))
  })
})
