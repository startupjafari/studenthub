import { Role } from '@studenthub/shared-types'
import { ExamsService } from './exams.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const dean: JwtPayload = {
  sub: 'dean-1',
  role: Role.DEAN,
  universityId: 'uni-1',
  facultyId: 'fac-1',
  groupId: null,
}

function setup(scored: number) {
  const prisma = {
    exam: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'ex-1',
        groupId: 'grp-1',
        course: {
          teacherId: 't-1',
          group: { facultyId: 'fac-1', faculty: { universityId: 'uni-1' } },
        },
      }),
      delete: jest.fn().mockResolvedValue({}),
    },
    examResult: { count: jest.fn().mockResolvedValue(scored) },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const service = new ExamsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  )
  return { service, prisma }
}

describe('ExamsService.remove — ведомость', () => {
  it('есть результаты → CONFLICT, экзамен остаётся', async () => {
    const { service, prisma } = setup(2)
    const err = await service.remove(dean, 'ex-1', ctx).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(prisma.exam.delete).not.toHaveBeenCalled()
  })

  it('без результатов удаляется', async () => {
    const { service, prisma } = setup(0)
    await service.remove(dean, 'ex-1', ctx)
    expect(prisma.exam.delete).toHaveBeenCalledWith({ where: { id: 'ex-1' } })
  })
})
