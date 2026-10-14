import { AuthService } from './auth.service'
import type { PasswordService } from '../../common/security/password.service'

// Refresh-токен — «id.secret». Один id без секрета не должен ни гасить цепочку сессий
// (через детектор повтора), ни разлогинивать.
describe('AuthService: refresh-токен без верного секрета', () => {
  function setup() {
    const record = {
      id: 'rt-1',
      userId: 'u1',
      familyId: 'fam-1',
      tokenHash: 'hash:good',
      revokedAt: new Date(), // уже ротирован — повтор с верным секретом был бы инцидентом
      expiresAt: new Date(Date.now() + 86_400_000),
    }
    const prisma = {
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue(record),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const passwords = {
      compare: jest.fn(async (plain: string, hash: string) => hash === `hash:${plain}`),
    }
    const audit = { record: jest.fn() }
    const service = new AuthService(
      prisma as never,
      {} as never,
      { get: jest.fn().mockReturnValue(0) } as never,
      audit as never,
      passwords as unknown as PasswordService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )
    return { service, prisma, audit }
  }

  it('refresh с чужим секретом → 401, цепочка не гасится', async () => {
    const { service, prisma, audit } = setup()
    await expect(service.refresh('rt-1.wrong', {})).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('logout с чужим секретом ничего не гасит', async () => {
    const { service, prisma } = setup()
    await service.logout('rt-1.wrong', {})
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled()
  })

  it('logout с верным секретом гасит цепочку', async () => {
    const { service, prisma } = setup()
    await service.logout('rt-1.good', {})
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { familyId: 'fam-1', revokedAt: null } }),
    )
  })
})
