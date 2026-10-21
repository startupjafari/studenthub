import { Role } from '@studenthub/shared-types'
import { ExamsService } from './exams.service'
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

function setup() {
  const prisma = {
    exam: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'ex-1',
        groupId: 'grp-1',
        date: new Date('2026-06-10T04:00:00.000Z'),
        roomId: null,
        examinerId: 't-1',
        course: {
          teacherId: 't-1',
          subject: { name: 'Матанализ' },
          group: { facultyId: 'fac-1', faculty: { universityId: 'uni-1' } },
        },
      }),
      update: jest.fn().mockResolvedValue({ id: 'ex-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    group: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ facultyId: 'fac-1', faculty: { universityId: 'uni-1' } }),
    },
    room: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const service = new ExamsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    { enqueue: jest.fn() } as unknown as QueueService,
  )
  return { service, prisma }
}

describe('ExamsService.update — аудитория', () => {
  it('аудитория чужого вуза → WRONG_SCOPE, экзамен не меняется', async () => {
    const { service, prisma } = setup()
    prisma.room.findUnique.mockResolvedValue({ universityId: 'uni-2' })
    const err = await service.update(dean, 'ex-1', { roomId: 'room-x' }, ctx).catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
    expect(prisma.exam.update).not.toHaveBeenCalled()
  })

  it('аудитория своего вуза → сохраняется', async () => {
    const { service, prisma } = setup()
    prisma.room.findUnique.mockResolvedValue({ universityId: 'uni-1' })
    await service.update(dean, 'ex-1', { roomId: 'room-1' }, ctx)
    expect(prisma.exam.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ roomId: 'room-1' }) }),
    )
  })
})
