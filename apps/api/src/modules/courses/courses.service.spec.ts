import { Role } from '@studenthub/shared-types'
import { CoursesService } from './courses.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const admin: JwtPayload = {
  sub: 'ua-1',
  role: Role.UNIVERSITY_ADMIN,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

function setup(counts: { grades?: number; submissions?: number; results?: number } = {}) {
  const prisma = {
    course: {
      findUnique: jest.fn().mockResolvedValue({ id: 'c-1', groupId: 'grp-1' }),
      delete: jest.fn().mockResolvedValue({}),
    },
    group: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ facultyId: 'fac-1', faculty: { universityId: 'uni-1' } }),
    },
    grade: { count: jest.fn().mockResolvedValue(counts.grades ?? 0) },
    submission: { count: jest.fn().mockResolvedValue(counts.submissions ?? 0) },
    examResult: { count: jest.fn().mockResolvedValue(counts.results ?? 0) },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const service = new CoursesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  )
  return { service, prisma }
}

describe('CoursesService.deleteCourse — академические записи', () => {
  it.each([{ grades: 1 }, { submissions: 2 }, { results: 1 }])(
    'есть записи %o → CONFLICT, дисциплина остаётся',
    async (counts) => {
      const { service, prisma } = setup(counts)
      const err = await service.deleteCourse(admin, 'c-1', ctx).catch((e) => e)
      expect(err.code).toBe('CONFLICT')
      expect(prisma.course.delete).not.toHaveBeenCalled()
    },
  )

  it('пустая дисциплина удаляется', async () => {
    const { service, prisma } = setup()
    await service.deleteCourse(admin, 'c-1', ctx)
    expect(prisma.course.delete).toHaveBeenCalledWith({ where: { id: 'c-1' } })
  })
})
