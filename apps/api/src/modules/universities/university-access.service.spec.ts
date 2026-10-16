import { Role } from '@studenthub/shared-types'
import { UniversityAccessService } from './university-access.service'
import type { PrismaService } from '../../common/prisma/prisma.service'

function setup(status: string | null) {
  const prisma = {
    university: {
      findUnique: jest.fn().mockResolvedValue(status === null ? null : { status }),
    },
  }
  const service = new UniversityAccessService(prisma as unknown as PrismaService)
  return { service, prisma }
}

const member = (role: Role, universityId: string | null = 'uni-1') => ({ role, universityId })

describe('UniversityAccessService — допуск по статусу вуза', () => {
  it('ACTIVE — пускает всех', async () => {
    const { service } = setup('ACTIVE')
    await expect(service.assertAllowed(member(Role.STUDENT))).resolves.toBeUndefined()
    await expect(service.assertAllowed(member(Role.UNIVERSITY_ADMIN))).resolves.toBeUndefined()
  })

  it('BLOCKED — не пускает никого из вуза, включая админа', async () => {
    const { service } = setup('BLOCKED')
    await expect(service.assertAllowed(member(Role.STUDENT))).rejects.toMatchObject({
      code: 'UNIVERSITY_BLOCKED',
    })
    await expect(service.assertAllowed(member(Role.UNIVERSITY_ADMIN))).rejects.toMatchObject({
      code: 'UNIVERSITY_BLOCKED',
    })
  })

  // Ограничения PENDING нет: вуз до запуска работает как прежде, решение за продуктом.
  it('PENDING — пускает всех', async () => {
    const { service } = setup('PENDING')
    for (const role of [Role.UNIVERSITY_ADMIN, Role.DEAN, Role.TEACHER, Role.STUDENT]) {
      await expect(service.assertAllowed(member(role))).resolves.toBeUndefined()
    }
  })

  it('платформенные роли и аккаунты без вуза статус не читают', async () => {
    const { service, prisma } = setup('BLOCKED')
    await expect(service.assertAllowed(member(Role.PLATFORM_ADMIN))).resolves.toBeUndefined()
    await expect(service.assertAllowed(member(Role.EMPLOYER, null))).resolves.toBeUndefined()
    expect(prisma.university.findUnique).not.toHaveBeenCalled()
  })

  it('ACTIVE запоминается: повторная проверка не ходит в БД', async () => {
    const { service, prisma } = setup('ACTIVE')
    await service.assertAllowed(member(Role.STUDENT))
    await service.assertAllowed(member(Role.TEACHER))
    expect(prisma.university.findUnique).toHaveBeenCalledTimes(1)
  })

  it('PENDING тоже запоминается', async () => {
    const { service, prisma } = setup('PENDING')
    await service.assertAllowed(member(Role.STUDENT))
    await service.assertAllowed(member(Role.STUDENT))
    expect(prisma.university.findUnique).toHaveBeenCalledTimes(1)
  })

  it('remember: смена статуса действует сразу, мимо памяти', async () => {
    const { service, prisma } = setup('ACTIVE')
    await service.assertAllowed(member(Role.STUDENT))
    service.remember('uni-1', 'BLOCKED')
    await expect(service.assertAllowed(member(Role.STUDENT))).rejects.toMatchObject({
      code: 'UNIVERSITY_BLOCKED',
    })
    expect(prisma.university.findUnique).toHaveBeenCalledTimes(1)
  })

  it('память истекает — статус перечитывается', async () => {
    let now = 1_000_000
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      const { service, prisma } = setup('ACTIVE')
      await service.assertAllowed(member(Role.STUDENT))
      prisma.university.findUnique.mockResolvedValue({ status: 'BLOCKED' })
      now += 16_000
      await expect(service.assertAllowed(member(Role.STUDENT))).rejects.toMatchObject({
        code: 'UNIVERSITY_BLOCKED',
      })
    } finally {
      spy.mockRestore()
    }
  })
})
