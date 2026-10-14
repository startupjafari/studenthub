import { Role } from '@studenthub/shared-types'
import { AssignmentsService } from './assignments.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const student: JwtPayload = {
  sub: 'stu-1',
  role: Role.STUDENT,
  universityId: 'uni-1',
  facultyId: 'fac-1',
  groupId: 'grp-1',
}

function setup(status: string) {
  const prisma = {
    assignment: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'as-1',
        status: 'PUBLISHED',
        // Срок прошёл, поздняя сдача запрещена.
        dueAt: new Date(Date.now() - 86_400_000),
        allowLate: false,
        course: { groupId: 'grp-1' },
      }),
    },
    submission: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'sub-1',
        status,
        text: 'исправлено',
        linkUrl: null,
        attemptNumber: 1,
      }),
      update: jest.fn().mockResolvedValue({ id: 'sub-1' }),
    },
  }
  const service = new AssignmentsService(
    prisma as unknown as PrismaService,
    {} as AuditService,
    {} as QueueService,
  )
  return { service, prisma }
}

describe('AssignmentsService.submit — срок сдачи', () => {
  it('черновик после срока без allowLate → CONFLICT', async () => {
    const { service } = setup('DRAFT')
    const err = await service.submit(student, 'as-1').catch((e) => e)
    expect(err.code).toBe('CONFLICT')
  })

  it('возвращённую на доработку работу можно сдать и после срока', async () => {
    const { service, prisma } = setup('RETURNED')
    await service.submit(student, 'as-1')
    expect(prisma.submission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SUBMITTED', attemptNumber: 2 }),
      }),
    )
  })
})
