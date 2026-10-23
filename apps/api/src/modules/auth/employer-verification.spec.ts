import { createHash } from 'node:crypto'
import { AuthService } from './auth.service'
import { CompaniesService } from '../career/companies.service'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

const EMPLOYER = {
  id: 'u-emp',
  role: 'EMPLOYER',
  isBlocked: false,
  passwordHash: 'hash',
  universityId: null,
  facultyId: null,
  groupId: null,
  twoFactorEnabled: false,
  companyMembership: { companyId: 'co-1' },
}

// D-F28: аккаунт из публичной регистрации работодателя входил и пользовался общими ручками
// платформы до подтверждения почты компании. Теперь вход, QR и refresh ждут подтверждения.
function setup(status: 'PENDING_EMAIL' | 'ACTIVE' | 'BLOCKED', user: object = EMPLOYER) {
  const companyFindFirst = jest.fn().mockResolvedValue({ status })
  const companies = new CompaniesService(
    { company: { findFirst: companyFindFirst } } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  )

  const tx = {
    refreshToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({ id: 'rt-new' }),
    },
  }
  const prisma = {
    refreshToken: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'rt-1',
        userId: 'u-emp',
        familyId: 'fam-1',
        tokenHash: sha256('good'),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: 'rt-new' }),
    },
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  }
  const users = {
    findByLoginIdentifierForAuth: jest.fn().mockResolvedValue(user),
    findByIdForAuth: jest.fn().mockResolvedValue(user),
  }
  const loginAttempts = {
    assertNotLocked: jest.fn(),
    registerFailure: jest.fn(),
    reset: jest.fn(),
  }
  const passwords = { compare: jest.fn().mockResolvedValue(true), hash: jest.fn() }
  const service = new AuthService(
    prisma as never,
    { sign: jest.fn(() => 'access') } as never,
    { get: jest.fn((k: string) => (k === 'JWT_REFRESH_EXPIRES_IN' ? '30d' : 0)) } as never,
    { record: jest.fn() } as never,
    passwords as never,
    users as never,
    {} as never,
    {} as never,
    loginAttempts as never,
    {} as never,
    {} as never,
    {} as never,
    { assertAllowed: jest.fn() } as never,
    companies,
    {} as never,
    { removeAllForUser: jest.fn() } as never,
  )
  return { service, prisma, tx, passwords, loginAttempts, companyFindFirst }
}

describe('AuthService: работодатель без подтверждённой почты компании', () => {
  it('вход по паролю → EMAIL_NOT_VERIFIED, но только после верного пароля', async () => {
    const { service, loginAttempts, companyFindFirst } = setup('PENDING_EMAIL')
    await expect(service.validateUser('hr@acme.kz', 'pw')).rejects.toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
    })
    expect(loginAttempts.reset).toHaveBeenCalled()
    expect(companyFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'co-1', deletedAt: null } }),
    )
  })

  it('неверный пароль → прежний UNAUTHORIZED, статус компании не раскрывается', async () => {
    const { service, passwords, companyFindFirst } = setup('PENDING_EMAIL')
    passwords.compare.mockResolvedValue(false)
    await expect(service.validateUser('hr@acme.kz', 'nope')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
    expect(companyFindFirst).not.toHaveBeenCalled()
  })

  it('подтверждённая компания — вход как раньше, companyId в токене', async () => {
    const { service } = setup('ACTIVE')
    await expect(service.validateUser('hr@acme.kz', 'pw')).resolves.toMatchObject({
      role: 'EMPLOYER',
      companyId: 'co-1',
    })
  })

  // Владелец заблокированной компании должен увидеть причину в кабинете — вход его пускает,
  // действия компании закрывает assertCompanyActive.
  it('заблокированная платформой компания вход не закрывает', async () => {
    const { service } = setup('BLOCKED')
    await expect(service.validateUser('hr@acme.kz', 'pw')).resolves.toMatchObject({
      companyId: 'co-1',
    })
  })

  it('вход по QR → EMAIL_NOT_VERIFIED', async () => {
    const { service } = setup('PENDING_EMAIL')
    await expect(service.issueSessionForUser('u-emp', {})).rejects.toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
    })
  })

  it('refresh сессии, выданной до правила, → EMAIL_NOT_VERIFIED: новой нет, цепочка цела', async () => {
    const { service, prisma, tx } = setup('PENDING_EMAIL')
    await expect(service.refresh('rt-1.good', {})).rejects.toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled()
    expect(tx.refreshToken.create).not.toHaveBeenCalled()
  })

  it('остальных ролей проверка не касается — запроса к компании нет', async () => {
    const { service, companyFindFirst } = setup('PENDING_EMAIL', {
      ...EMPLOYER,
      role: 'STUDENT',
      universityId: 'uni-1',
      companyMembership: null,
    })
    await expect(service.validateUser('student', 'pw')).resolves.toMatchObject({ role: 'STUDENT' })
    expect(companyFindFirst).not.toHaveBeenCalled()
  })
})
