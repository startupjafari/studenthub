import { Role } from '@studenthub/shared-types'
import { SearchService } from './search.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

function setup() {
  const many = () => ({ findMany: jest.fn().mockResolvedValue([]) })
  const prisma = {
    user: many(),
    course: many(),
    assignment: many(),
    material: many(),
    event: many(),
    chat: many(),
  }
  const service = new SearchService(prisma as unknown as PrismaService)
  return { service, prisma }
}

const student: JwtPayload = {
  sub: 'stu-1',
  role: Role.STUDENT,
  universityId: 'uni-1',
  facultyId: 'fac-1',
  groupId: 'grp-1',
}

describe('SearchService — события', () => {
  it('студенту — только события своей аудитории, а не всего вуза', async () => {
    const { service, prisma } = setup()
    await service.search(student, 'день')
    const where = prisma.event.findMany.mock.calls[0][0].where
    expect(where.AND[0]).toEqual({ universityId: 'uni-1' })
    const audiences = where.AND[1].OR
    expect(audiences).toContainEqual({ audience: 'FACULTY', facultyId: 'fac-1' })
    expect(audiences).toContainEqual({ audience: 'GROUP', groupId: 'grp-1' })
    expect(audiences.some((o: { audience?: string }) => o.audience === 'TEACHERS')).toBe(false)
  })

  it('чаты — только где он участник и не забанен', async () => {
    const { service, prisma } = setup()
    await service.search(student, 'чат')
    expect(prisma.chat.findMany.mock.calls[0][0].where.members).toEqual({
      some: { userId: 'stu-1', bannedAt: null },
    })
  })
})
