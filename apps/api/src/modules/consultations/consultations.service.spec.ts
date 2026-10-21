import { Role } from '@studenthub/shared-types'
import { CreateSlotSchema } from '@studenthub/shared-schemas'
import { ConsultationsService, slotOrderBy } from './consultations.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Порядок строк таблицы — то место, где ошибка не видна на экране: список выглядит
// упорядоченным в любом случае, а страницы при этом могут перемешиваться.
describe('slotOrderBy', () => {
  it('по времени — единственный ключ: он уникален сам по себе', () => {
    expect(slotOrderBy('startsAt', 'desc')).toEqual([{ startsAt: 'desc' }])
  })

  it('по статусу — вторым ключом время, иначе порядок страниц непредсказуем', () => {
    // Статусов три на сотню слотов: без второго ключа СУБД вправе вернуть строки с
    // одинаковым статусом в любом порядке, и одна и та же запись попадала бы то на
    // первую страницу, то на вторую.
    expect(slotOrderBy('status', 'asc')).toEqual([{ status: 'asc' }, { startsAt: 'asc' }])
  })

  it('по студенту — по фамилии и имени, а не по studentId', () => {
    // studentId это uuid: сортировка по нему дала бы случайный порядок, выглядящий
    // как осмысленный.
    expect(slotOrderBy('student', 'asc')).toEqual([
      { student: { lastName: 'asc' } },
      { student: { firstName: 'asc' } },
      { startsAt: 'asc' },
    ])
  })

  it('направление применяется ко всем ключам имени, но не к запасному времени', () => {
    const order = slotOrderBy('student', 'desc')
    expect(order[0]).toEqual({ student: { lastName: 'desc' } })
    // Запасной ключ всегда возрастающий: он не про выбор пользователя, а про
    // устойчивость порядка между страницами.
    expect(order[order.length - 1]).toEqual({ startsAt: 'asc' })
  })
})

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const student: JwtPayload = {
  sub: 'stu-1',
  role: Role.STUDENT,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

function setup(slot: Record<string, unknown>) {
  const prisma = {
    consultationSlot: {
      findUnique: jest.fn().mockResolvedValue(slot),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'slot-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
    },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const service = new ConsultationsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
  )
  return { service, prisma, queue }
}

const future = new Date(Date.now() + 86_400_000)
const openSlot = {
  id: 'slot-1',
  status: 'OPEN',
  startsAt: future,
  teacherId: 't-1',
  teacher: { universityId: 'uni-1', deletedAt: null, isBlocked: false },
}

describe('ConsultationsService — запись на слот', () => {
  it('запись условная: слот занимается только из OPEN', async () => {
    const { service, prisma } = setup(openSlot)
    await service.book(student, 'slot-1', { topic: 'Курсовая' }, ctx)
    expect(prisma.consultationSlot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'slot-1', status: 'OPEN' } }),
    )
  })

  it('слот успели занять между чтением и записью → CONFLICT, уведомления нет', async () => {
    const { service, prisma, queue } = setup(openSlot)
    prisma.consultationSlot.updateMany.mockResolvedValue({ count: 0 })
    const err = await service.book(student, 'slot-1', {}, ctx).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('удалённый преподаватель → слота как бы нет', async () => {
    const { service } = setup({
      ...openSlot,
      teacher: { universityId: 'uni-1', deletedAt: new Date(), isBlocked: false },
    })
    const err = await service.book(student, 'slot-1', {}, ctx).catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })

  it('отмена студентом слота, уже отменённого преподавателем → CONFLICT, слот не открывается', async () => {
    const { service, prisma } = setup({
      id: 'slot-1',
      status: 'CANCELLED',
      startsAt: future,
      teacherId: 't-1',
      studentId: 'stu-1',
    })
    prisma.consultationSlot.updateMany.mockResolvedValue({ count: 0 })
    const err = await service.cancel(student, 'slot-1', ctx).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(prisma.consultationSlot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'slot-1', studentId: 'stu-1', status: 'BOOKED' } }),
    )
  })
})

// ── C-F23: слот в будущем, без нахлёста; список преподавателей считает БД ────────
const teacherActor: JwtPayload = {
  sub: 't-1',
  role: Role.TEACHER,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

function setupSlots() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    consultationSlot: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'slot-new' }),
    },
  }
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    consultationSlot: {
      findUnique: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const service = new ConsultationsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
  )
  return { service, prisma, tx, queue }
}

const HOUR = 60 * 60_000
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString()

describe('ConsultationsService.createSlot (C-F23)', () => {
  it('слот в прошлом → VALIDATION_ERROR, ничего не пишется', async () => {
    const { service, prisma } = setupSlots()
    const err = await service
      .createSlot(teacherActor, { startsAt: at(-HOUR), endsAt: at(-HOUR / 2) }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.details).toEqual([expect.objectContaining({ field: 'startsAt' })])
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('слот длиннее 8 часов (опечатка в дате) → VALIDATION_ERROR', async () => {
    const { service } = setupSlots()
    const err = await service
      .createSlot(teacherActor, { startsAt: at(HOUR), endsAt: at(HOUR + 2 * 24 * HOUR) }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.details).toEqual([expect.objectContaining({ field: 'endsAt' })])
  })

  it('пересечение со своим открытым/занятым слотом → CONFLICT, слот не создаётся', async () => {
    const { service, tx } = setupSlots()
    tx.consultationSlot.findFirst.mockResolvedValue({ id: 'slot-old' })
    const startsAt = at(HOUR)
    const endsAt = at(2 * HOUR)
    const err = await service.createSlot(teacherActor, { startsAt, endsAt }, ctx).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(tx.consultationSlot.create).not.toHaveBeenCalled()
    // Пересечение интервалов: чужое начало раньше нашего конца, чужой конец позже начала.
    expect(tx.consultationSlot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          teacherId: 't-1',
          status: { in: ['OPEN', 'BOOKED'] },
          startsAt: { lt: new Date(endsAt) },
          endsAt: { gt: new Date(startsAt) },
        },
      }),
    )
  })

  it('свободное время → слот создаётся под локом преподавателя', async () => {
    const { service, tx } = setupSlots()
    await service.createSlot(teacherActor, { startsAt: at(HOUR), endsAt: at(2 * HOUR) }, ctx)
    expect(tx.$executeRaw).toHaveBeenCalled()
    expect(tx.consultationSlot.create).toHaveBeenCalled()
  })
})

describe('ConsultationsService.listTeachers (C-F23)', () => {
  it('счёт открытых слотов — GROUP BY по преподавателю, имена отдельным запросом', async () => {
    const { service, prisma } = setupSlots()
    prisma.consultationSlot.groupBy.mockResolvedValue([
      { teacherId: 't-2', _count: { _all: 3 } },
      { teacherId: 't-1', _count: { _all: 1 } },
    ])
    prisma.user.findMany.mockResolvedValue([
      { id: 't-1', firstName: 'Айгуль', lastName: 'Бекова', avatarUrl: null },
      { id: 't-2', firstName: 'Ержан', lastName: 'Абаев', avatarUrl: null },
    ])
    const res = await service.listTeachers(student)
    expect(prisma.consultationSlot.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['teacherId'], _count: { _all: true } }),
    )
    expect(res).toEqual([
      { teacherId: 't-2', firstName: 'Ержан', lastName: 'Абаев', avatarUrl: null, openSlots: 3 },
      { teacherId: 't-1', firstName: 'Айгуль', lastName: 'Бекова', avatarUrl: null, openSlots: 1 },
    ])
  })

  it('нет открытых слотов — второго запроса нет', async () => {
    const { service, prisma } = setupSlots()
    await expect(service.listTeachers(student)).resolves.toEqual([])
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })
})

describe('ConsultationsService.deleteSlot — одно уведомление об отмене (C-F23)', () => {
  const slotRow = (status: string, startsAt: Date) => ({
    id: 'slot-1',
    teacherId: 't-1',
    studentId: 'stu-1',
    status,
    startsAt,
    teacher: { university: { timezone: 'Asia/Almaty' } },
  })

  it('занятый будущий слот: уведомление после удаления, ключ — как у отмены преподавателем', async () => {
    const { service, prisma, queue } = setupSlots()
    prisma.consultationSlot.findUnique.mockResolvedValue(slotRow('BOOKED', future))
    const order: string[] = []
    prisma.consultationSlot.delete.mockImplementation(async () => order.push('delete'))
    queue.enqueue.mockImplementation(async () => order.push('notify'))
    await service.deleteSlot(teacherActor, 'slot-1', ctx)
    expect(order).toEqual(['delete', 'notify'])
    expect(queue.enqueue.mock.calls[0][2].dedupeKey).toBe('consultation-cancelled:slot-1:teacher')
  })

  it('слот, уже отменённый преподавателем, удаляется без второго уведомления', async () => {
    const { service, prisma, queue } = setupSlots()
    prisma.consultationSlot.findUnique.mockResolvedValue(slotRow('CANCELLED', future))
    await service.deleteSlot(teacherActor, 'slot-1', ctx)
    expect(prisma.consultationSlot.delete).toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('прошедшая консультация удаляется молча', async () => {
    const { service, prisma, queue } = setupSlots()
    prisma.consultationSlot.findUnique.mockResolvedValue(
      slotRow('BOOKED', new Date(Date.now() - HOUR)),
    )
    await service.deleteSlot(teacherActor, 'slot-1', ctx)
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})

describe('CreateSlotSchema — порядок времени по моментам, а не по строкам (C-F23)', () => {
  it('разные смещения: 06:00Z позже 10:00+05:00 — слот валиден', () => {
    const res = CreateSlotSchema.safeParse({
      startsAt: '2026-10-20T10:00:00+05:00',
      endsAt: '2026-10-20T06:00:00Z',
    })
    expect(res.success).toBe(true)
  })

  it('конец раньше начала в другом смещении — отказ', () => {
    const res = CreateSlotSchema.safeParse({
      startsAt: '2026-10-20T06:00:00Z',
      endsAt: '2026-10-20T10:30:00+05:00',
    })
    expect(res.success).toBe(false)
  })
})
