import { Role } from '@studenthub/shared-types'
import { AppointmentsService } from './appointments.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const dean: JwtPayload = {
  sub: 'dean-1',
  role: Role.DEAN,
  universityId: 'uni-1',
  facultyId: 'fac-1',
  groupId: null,
}
const student: JwtPayload = {
  sub: 'stu-1',
  role: Role.STUDENT,
  universityId: 'uni-1',
  facultyId: 'fac-1',
  groupId: null,
}

function setup(status: string) {
  const prisma = {
    deaneryAppointment: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'ap-1',
        studentId: 'stu-1',
        status,
        facultyId: 'fac-1',
        faculty: { universityId: 'uni-1', university: { timezone: 'Asia/Almaty' } },
      }),
      update: jest.fn().mockResolvedValue({ id: 'ap-1' }),
    },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const service = new AppointmentsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
  )
  return { service, prisma, queue }
}

describe('AppointmentsService — переходы статусов', () => {
  it('подтвердить запись, которую студент уже отменил, нельзя', async () => {
    const { service, prisma } = setup('CANCELLED')
    const err = await service
      .confirm(dean, 'ap-1', { scheduledAt: '2026-10-02T04:00:00.000Z' }, 'CONFIRMED', ctx)
      .catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(prisma.deaneryAppointment.update).not.toHaveBeenCalled()
  })

  it('отменить уже отменённую — CONFLICT', async () => {
    const { service } = setup('CANCELLED')
    const err = await service.cancelMine(student, 'ap-1', ctx).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
  })

  it('подтверждение: запись условная, время в уведомлении — по поясу вуза', async () => {
    const { service, prisma, queue } = setup('REQUESTED')
    await service.confirm(
      dean,
      'ap-1',
      { scheduledAt: '2026-10-02T04:00:00.000Z' },
      'CONFIRMED',
      ctx,
    )
    expect(prisma.deaneryAppointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ap-1', status: 'REQUESTED' } }),
    )
    const payload = queue.enqueue.mock.calls[0][2]
    expect(payload.body).toBe('2026-10-02 09:00')
    expect(payload.dedupeKey).toContain('2026-10-02 09:00')
  })
})

describe('AppointmentsService.listQueue — архив не вытесняет новые записи', () => {
  function setupQueue() {
    const findMany = jest.fn().mockResolvedValue([])
    const service = new AppointmentsService(
      { deaneryAppointment: { findMany } } as unknown as PrismaService,
      { record: jest.fn() } as unknown as AuditService,
      { enqueue: jest.fn() } as unknown as QueueService,
    )
    return { service, findMany }
  }

  it('по умолчанию — только открытые записи, ближайшие сверху', async () => {
    const { service, findMany } = setupQueue()
    await service.listQueue(dean, {})
    const args = findMany.mock.calls[0][0]
    expect(args.where).toEqual({
      facultyId: 'fac-1',
      status: { in: ['REQUESTED', 'CONFIRMED', 'RESCHEDULED'] },
    })
    // Без сортировки по строке статуса: она ставила CANCELLED/COMPLETED в начало.
    expect(args.orderBy).toEqual([{ requestedAt: 'asc' }, { id: 'asc' }])
    expect(args.take).toBe(300)
  })

  it('архив — закрытые записи, свежие сверху, следующая страница по cursor', async () => {
    const { service, findMany } = setupQueue()
    await service.listQueue(dean, { view: 'closed', cursor: 'ap-9', limit: 50 })
    const args = findMany.mock.calls[0][0]
    expect(args.where.status).toEqual({ in: ['COMPLETED', 'CANCELLED'] })
    expect(args.orderBy).toEqual([{ requestedAt: 'desc' }, { id: 'desc' }])
    expect(args).toMatchObject({ take: 50, cursor: { id: 'ap-9' }, skip: 1 })
  })

  it('явный статус важнее среза, scope факультета сохраняется', async () => {
    const { service, findMany } = setupQueue()
    await service.listQueue(dean, { status: 'CANCELLED', view: 'active' })
    expect(findMany.mock.calls[0][0].where).toEqual({
      facultyId: 'fac-1',
      status: { in: ['CANCELLED'] },
    })
  })
})

// ── C-F24: проверки записи и уведомление деканата ─────────────────────────────
describe('AppointmentsService.create (C-F24)', () => {
  function setupCreate(
    opts: { active?: number; application?: { id: string } | null; deans?: { id: string }[] } = {},
  ) {
    const prisma = {
      deaneryAppointment: {
        count: jest.fn().mockResolvedValue(opts.active ?? 0),
        create: jest.fn().mockResolvedValue({ id: 'ap-new' }),
      },
      application: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.application === undefined ? { id: 'app-1' } : opts.application),
      },
      user: { findMany: jest.fn().mockResolvedValue(opts.deans ?? [{ id: 'dean-1' }]) },
      faculty: {
        findUnique: jest.fn().mockResolvedValue({ university: { timezone: 'Asia/Almaty' } }),
      },
    }
    const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
    const service = new AppointmentsService(
      prisma as unknown as PrismaService,
      { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService,
      queue as unknown as QueueService,
    )
    return { service, prisma, queue }
  }

  const tomorrow = '2099-10-02T04:00:00.000Z'

  it('желаемое время в прошлом → VALIDATION_ERROR, запись не создаётся', async () => {
    const { service, prisma } = setupCreate()
    const past = new Date(Date.now() - 60 * 60_000).toISOString()
    const err = await service
      .create(student, { type: 'OTHER', requestedAt: past }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.details).toEqual([expect.objectContaining({ field: 'requestedAt' })])
    expect(prisma.deaneryAppointment.create).not.toHaveBeenCalled()
  })

  it('чужая или несуществующая заявка → VALIDATION_ERROR; ищется среди заявок самого студента', async () => {
    const { service, prisma } = setupCreate({ application: null })
    const err = await service
      .create(student, { type: 'DOCUMENT', requestedAt: tomorrow, applicationId: 'app-x' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(prisma.application.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'app-x', studentId: 'stu-1', deletedAt: null } }),
    )
    expect(prisma.deaneryAppointment.create).not.toHaveBeenCalled()
  })

  it('открытых записей уже на потолке → CONFLICT', async () => {
    const { service, prisma } = setupCreate({ active: 5 })
    const err = await service
      .create(student, { type: 'OTHER', requestedAt: tomorrow }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(prisma.deaneryAppointment.count).toHaveBeenCalledWith({
      where: { studentId: 'stu-1', status: { in: ['REQUESTED', 'CONFIRMED', 'RESCHEDULED'] } },
    })
    expect(prisma.deaneryAppointment.create).not.toHaveBeenCalled()
  })

  it('новая запись → уведомление деканам факультета, время по поясу вуза', async () => {
    const { service, prisma, queue } = setupCreate({ deans: [{ id: 'dean-1' }, { id: 'dean-2' }] })
    await service.create(
      student,
      { type: 'DOCUMENT', requestedAt: tomorrow, applicationId: 'app-1' },
      ctx,
    )
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: Role.DEAN, facultyId: 'fac-1', deletedAt: null, isBlocked: false },
      }),
    )
    const [queueName, , payload, opts] = queue.enqueue.mock.calls[0]
    expect(queueName).toBe('notifications')
    expect(payload).toMatchObject({
      recipientIds: ['dean-1', 'dean-2'],
      titleKey: 'appointments.requested.title',
      body: '2099-10-02 09:00',
      dedupeKey: 'appointment-requested:ap-new',
    })
    expect(opts).toEqual({ jobId: 'appointment-requested:ap-new' })
  })

  it('деканов на факультете нет — запись создаётся, уведомления нет', async () => {
    const { service, prisma, queue } = setupCreate({ deans: [] })
    await service.create(student, { type: 'OTHER', requestedAt: tomorrow }, ctx)
    expect(prisma.deaneryAppointment.create).toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})
