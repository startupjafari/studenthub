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
    scheduleChange: { create: jest.fn(), findMany: jest.fn() },
    group: { findUnique: jest.fn() },
    user: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    university: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Almaty' }) },
    $transaction: jest.fn(),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const rooms = { assertRoomInUniversity: jest.fn().mockResolvedValue(undefined) }
  const realtime = { emitToRoom: jest.fn(), emitEventToRoom: jest.fn() }
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
    prisma.user.findFirst.mockResolvedValue({ universityId: 'uni-1' })
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

// ── 6.5 Замена → WS + уведомление ───────────────────────────────────────────
describe('SchedulesService.createChange — WS + очередь (6.5)', () => {
  const admin = viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-1' })

  it('пишет БД, шлёт WS schedule:changed в комнату группы и ставит job', async () => {
    const { service, prisma, realtime, queue } = setup()
    prisma.pair.findUnique.mockResolvedValue({
      id: 'pair-1',
      groupId: 'grp-1',
      subject: 'Матанализ',
      teacherId: 't-1',
    })
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    prisma.scheduleChange.create.mockResolvedValue({
      id: 'chg-1',
      pairId: 'pair-1',
      type: 'CANCELLED',
    })
    prisma.user.findMany.mockResolvedValue([{ id: 's-1' }, { id: 's-2' }])

    const res = await service.createChange(
      admin,
      { pairId: 'pair-1', type: 'CANCELLED', date: '2026-09-15' },
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
  }

  function primeCreate(prisma: ReturnType<typeof setup>['prisma']): void {
    prisma.schedule.findUnique.mockResolvedValue({ id: 'sch-1', groupId: 'grp-1' })
    prisma.group.findUnique.mockResolvedValue(GROUP_CTX)
    prisma.user.findFirst.mockResolvedValue({ universityId: 'uni-1' })
    prisma.pair.findMany.mockResolvedValue([])
    prisma.pair.create.mockResolvedValue(createdPair())
  }

  it('создаёт свою пару (teacherId=self) → успех', async () => {
    const { service, prisma } = setup()
    primeCreate(prisma)
    await service.createPair(teacher, ownInput, ctx)
    expect(prisma.pair.create).toHaveBeenCalled()
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
    prisma.user.findFirst.mockResolvedValue({ universityId: 'uni-1' })
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
    ok.prisma.pair.findUnique.mockResolvedValue({ id: 'p-1', groupId: 'grp-1', teacherId: T })
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
