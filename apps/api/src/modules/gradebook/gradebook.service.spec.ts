import { Role } from '@studenthub/shared-types'
import { GradebookService } from './gradebook.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { RealtimeGateway } from '../../common/realtime'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const teacher: JwtPayload = {
  sub: 't-1',
  role: Role.TEACHER,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

function setup(published: boolean, graded: number) {
  const prisma = {
    gradeColumn: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'col-1',
        published,
        course: {
          id: 'c-1',
          groupId: 'grp-1',
          teacherId: 't-1',
          group: { facultyId: 'fac-1', faculty: { universityId: 'uni-1' } },
        },
      }),
      delete: jest.fn().mockResolvedValue({}),
    },
    grade: { count: jest.fn().mockResolvedValue(graded) },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const service = new GradebookService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    {} as RealtimeGateway,
  )
  return { service, prisma }
}

describe('GradebookService.deleteColumn', () => {
  it('опубликованная колонка с оценками → CONFLICT, оценки остаются', async () => {
    const { service, prisma } = setup(true, 3)
    const err = await service.deleteColumn(teacher, 'col-1', ctx).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(prisma.gradeColumn.delete).not.toHaveBeenCalled()
  })

  it('черновая колонка удаляется даже с оценками', async () => {
    const { service, prisma } = setup(false, 3)
    await service.deleteColumn(teacher, 'col-1', ctx)
    expect(prisma.gradeColumn.delete).toHaveBeenCalled()
  })
})
