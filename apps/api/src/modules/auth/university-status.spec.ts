import { createHash } from 'node:crypto'
import { AuthService } from './auth.service'
import { UniversityAccessService } from '../universities/university-access.service'
import type { PrismaService } from '../../common/prisma/prisma.service'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

const STUDENT = {
  id: 'u1',
  role: 'STUDENT',
  isBlocked: false,
  passwordHash: 'hash',
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
  twoFactorEnabled: false,
  companyMembership: null,
}

// Блокировка вуза закрывает все пути к сессии: вход по паролю, QR, refresh и регистрацию по
// инвайту. Раньше BLOCKED был только подписью в таблице админки.
function setup(status: 'ACTIVE' | 'BLOCKED' | 'PENDING') {
  const access = new UniversityAccessService({
    university: { findUnique: jest.fn().mockResolvedValue({ status }) },
  } as unknown as PrismaService)

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
        userId: 'u1',
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
    findByLoginIdentifierForAuth: jest.fn().mockResolvedValue(STUDENT),
    findByIdForAuth: jest.fn().mockResolvedValue(STUDENT),
    createInvitedUser: jest.fn().mockResolvedValue({ sub: 'u-new' }),
  }
  const invites = {
    claimInvite: jest.fn().mockResolvedValue({
      id: 'inv-1',
      role: 'DEAN',
      email: 'dean@uni.kz',
      universityId: 'uni-1',
      facultyId: 'fac-1',
      groupId: null,
    }),
    markUsed: jest.fn(),
  }
  const loginAttempts = {
    assertNotLocked: jest.fn(),
    registerFailure: jest.fn(),
    reset: jest.fn(),
  }
  const passwords = { compare: jest.fn().mockResolvedValue(true), hash: jest.fn() }
  const audit = { record: jest.fn() }
  const service = new AuthService(
    prisma as never,
    { sign: jest.fn(() => 'access') } as never,
    { get: jest.fn((k: string) => (k === 'JWT_REFRESH_EXPIRES_IN' ? '30d' : 0)) } as never,
    audit as never,
    passwords as never,
    users as never,
    invites as never,
    {} as never,
    loginAttempts as never,
    {} as never,
    {} as never,
    {} as never,
    access,
  )
  return { service, prisma, tx, users, invites, loginAttempts }
}

const registration = {
  token: 'invite-token',
  username: 'dean',
  firstName: 'Декан',
  lastName: 'Деканов',
  password: 'Secret123!',
  birthDate: '1980-01-01',
  consent: true as const,
}

describe('AuthService: вуз заблокирован', () => {
  it('вход по паролю → UNIVERSITY_BLOCKED, но только после верного пароля', async () => {
    const { service, loginAttempts } = setup('BLOCKED')
    await expect(service.validateUser('student', 'pw')).rejects.toMatchObject({
      code: 'UNIVERSITY_BLOCKED',
    })
    expect(loginAttempts.reset).toHaveBeenCalled()
  })

  it('неверный пароль → прежний UNAUTHORIZED, статус вуза не раскрывается', async () => {
    const { service } = setup('BLOCKED')
    const withWrongPassword = service as unknown as { passwords: { compare: jest.Mock } }
    withWrongPassword.passwords.compare.mockResolvedValue(false)
    await expect(service.validateUser('student', 'nope')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })

  it('refresh → UNIVERSITY_BLOCKED: сессия не выдаётся, цепочка не гасится', async () => {
    const { service, prisma, tx } = setup('BLOCKED')
    await expect(service.refresh('rt-1.good', {})).rejects.toMatchObject({
      code: 'UNIVERSITY_BLOCKED',
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled()
    expect(tx.refreshToken.create).not.toHaveBeenCalled()
  })

  it('вход по QR → UNIVERSITY_BLOCKED', async () => {
    const { service } = setup('BLOCKED')
    await expect(service.issueSessionForUser('u1', {})).rejects.toMatchObject({
      code: 'UNIVERSITY_BLOCKED',
    })
  })

  it('регистрация по инвайту → UNIVERSITY_BLOCKED до создания пользователя', async () => {
    const { service, users, invites } = setup('BLOCKED')
    await expect(service.registerByInvite(registration, {})).rejects.toMatchObject({
      code: 'UNIVERSITY_BLOCKED',
    })
    // Отказ брошен внутри транзакции после захвата инвайта — откат возвращает его в PENDING.
    expect(invites.claimInvite).toHaveBeenCalled()
    expect(users.createInvitedUser).not.toHaveBeenCalled()
    expect(invites.markUsed).not.toHaveBeenCalled()
  })
})

describe('AuthService: вуз ещё не запущен (PENDING) — ограничений нет', () => {
  it('студент входит', async () => {
    const { service } = setup('PENDING')
    await expect(service.validateUser('student', 'pw')).resolves.toMatchObject({
      role: 'STUDENT',
      universityId: 'uni-1',
    })
  })

  it('декан по инвайту, выданному в мастере до запуска, регистрируется', async () => {
    const { service, users } = setup('PENDING')
    users.createInvitedUser.mockResolvedValue({
      sub: 'u-dean',
      role: 'DEAN',
      universityId: 'uni-1',
    })
    await expect(service.registerByInvite(registration, {})).resolves.toMatchObject({
      accessToken: 'access',
    })
    expect(users.createInvitedUser).toHaveBeenCalled()
  })
})

describe('AuthService: вуз работает (ACTIVE)', () => {
  it('refresh выдаёт новую сессию как раньше', async () => {
    const { service } = setup('ACTIVE')
    await expect(service.refresh('rt-1.good', {})).resolves.toMatchObject({
      accessToken: 'access',
    })
  })
})
