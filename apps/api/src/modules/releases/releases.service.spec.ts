import { Prisma } from '@prisma/client'
import { ReleasesService } from './releases.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { UserService } from '../users/users.service'

const REGISTERED_AT = new Date('2026-01-10T08:00:00Z')
const SEEN_AT = new Date('2026-09-07T12:00:00Z')

function setup(view: { version: string; seenAt: Date } | null = null) {
  const prisma = {
    releaseView: {
      findUnique: jest.fn().mockResolvedValue(view),
      upsert: jest.fn().mockResolvedValue({ version: '1.7.0', seenAt: SEEN_AT }),
    },
  }
  const users = { registeredAt: jest.fn().mockResolvedValue(REGISTERED_AT) }
  const service = new ReleasesService(
    prisma as unknown as PrismaService,
    users as unknown as UserService,
  )
  return { service, prisma, users }
}

describe('ReleasesService', () => {
  it('отдаёт пустое состояние, но с датой регистрации — по ней клиент молчит для новичков', async () => {
    const { service } = setup(null)

    await expect(service.state('u1')).resolves.toEqual({
      version: null,
      seenAt: null,
      accountCreatedAt: REGISTERED_AT,
    })
  })

  it('отдаёт прочитанную версию', async () => {
    const { service } = setup({ version: '1.6.0', seenAt: SEEN_AT })

    await expect(service.state('u1')).resolves.toEqual({
      version: '1.6.0',
      seenAt: SEEN_AT,
      accountCreatedAt: REGISTERED_AT,
    })
  })

  it('пишет отметку на userId из токена, а не из тела запроса', async () => {
    const { service, prisma } = setup()

    await expect(service.markSeen('u1', { version: '1.7.0' })).resolves.toEqual({
      version: '1.7.0',
      seenAt: SEEN_AT,
    })
    expect(prisma.releaseView.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1' },
        create: { userId: 'u1', version: '1.7.0' },
      }),
    )
  })

  it('удалённый пользователь с живым токеном получает NOT_FOUND, а не ошибку Prisma', async () => {
    const { service, prisma } = setup()
    prisma.releaseView.upsert.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('FK', { code: 'P2003', clientVersion: 'test' }),
    )

    await expect(service.markSeen('u1', { version: '1.7.0' })).rejects.toBeInstanceOf(AppException)
  })
})
