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
