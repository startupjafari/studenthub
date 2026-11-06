import { Role } from '@studenthub/shared-types'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { SecurityPassesService } from './security-passes.service'

const actor = (role: Role, universityId: string | null = 'uni-A'): JwtPayload => ({
  sub: 'g-1',
  role,
  universityId,
  facultyId: null,
  groupId: null,
})

function setup() {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ firstName: 'Ерлан', lastName: 'Тестов' }) },
    university: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Almaty' }) },
    securityPass: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    securityVisitor: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  const service = new SecurityPassesService(prisma as unknown as PrismaService)
  return { service, prisma }
}

describe('SecurityPassesService', () => {
  it('проход пишется в вуз охранника со снимком имён', async () => {
    const { service, prisma } = setup()
    await service.record({
      guard: actor(Role.SECURITY_GUARD),
      student: { id: 'stu-1', name: 'Петров Иван', group: 'BT-201' },
      allowed: true,
      denyReason: null,
    })
    expect(prisma.securityPass.create.mock.calls[0][0].data).toEqual({
      universityId: 'uni-A',
      guardId: 'g-1',
      guardName: 'Тестов Ерлан',
      studentId: 'stu-1',
      studentName: 'Петров Иван',
      studentGroup: 'BT-201',
      allowed: true,
      denyReason: null,
    })
  })

  it('сбой журнала не роняет проверку на входе', async () => {
    const { service, prisma } = setup()
    prisma.securityPass.create.mockRejectedValue(new Error('db down'))
    await expect(
      service.record({
        guard: actor(Role.SECURITY_GUARD),
        student: null,
        allowed: false,
        denyReason: 'INVALID_QR',
      }),
    ).resolves.toBeUndefined()
  })

  it('журнал: только свой вуз, фильтр по исходу', async () => {
    const { service, prisma } = setup()
    await service.list(actor(Role.UNIVERSITY_ADMIN), { page: 2, limit: 10, allowed: false })
    const args = prisma.securityPass.findMany.mock.calls[0][0]
    expect(args.where).toEqual({ universityId: 'uni-A', allowed: false })
    expect(args).toMatchObject({ skip: 10, take: 10 })
  })

  it('сводка — за сегодня по часам вуза, отказы = всего − пропущено', async () => {
    const { service, prisma } = setup()
    prisma.securityPass.count.mockResolvedValueOnce(12).mockResolvedValueOnce(10)
    prisma.securityVisitor.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1)
    await expect(service.summary(actor(Role.SECURITY_GUARD))).resolves.toMatchObject({
      passes: { total: 12, allowed: 10, denied: 2 },
      visitors: { today: 3, inside: 1 },
    })
    expect(prisma.securityVisitor.count.mock.calls[1][0].where).toEqual({
      universityId: 'uni-A',
      exitedAt: null,
    })
  })

  it('другим ролям журнал закрыт', async () => {
    const { service } = setup()
    await expect(service.summary(actor(Role.TEACHER))).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
