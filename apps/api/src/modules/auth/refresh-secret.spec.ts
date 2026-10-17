import { createHash } from 'node:crypto'
import { AuthService } from './auth.service'
import type { PasswordService } from '../../common/security/password.service'

// Так секрет refresh лежит в БД: SHA-256 в hex.
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

// Запись, выданная до перехода на SHA-256: bcrypt-хэш (в тестах — узнаваемая заглушка с
// тем же префиксом, настоящий bcrypt здесь только замедлял бы прогон).
const LEGACY_BCRYPT_HASH = '$2b$12$legacy-hash-of-good'

// Refresh-токен — «id.secret». Один id без секрета не должен ни гасить цепочку сессий
// (через детектор повтора), ни разлогинивать.
describe('AuthService: refresh-токен без верного секрета', () => {
  function setup() {
    const record = {
      id: 'rt-1',
      userId: 'u1',
      familyId: 'fam-1',
      tokenHash: sha256('good'),
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
    const passwords = { compare: jest.fn() }
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
      { assertAllowed: jest.fn() } as never,
      {} as never,
    )
    return { service, prisma, audit, passwords }
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

  it('logout с верным секретом гасит цепочку — без bcrypt', async () => {
    const { service, prisma, passwords } = setup()
    await service.logout('rt-1.good', {})
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { familyId: 'fam-1', revokedAt: null } }),
    )
    expect(passwords.compare).not.toHaveBeenCalled()
  })
})

// Секрет refresh — 122 бита случайности: хранится SHA-256, а не bcrypt. Два bcrypt cost 12 на
// каждый обмен забивали пул libuv. Старые bcrypt-записи обязаны работать, пока не истекут.
describe('AuthService: хэш секрета refresh', () => {
  function setup(record: Record<string, unknown> | null = null) {
    const created: { tokenHash: string }[] = []
    const tx = {
      refreshToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn(async ({ data }: { data: { tokenHash: string } }) => {
          created.push(data)
          return { id: 'rt-new' }
        }),
      },
    }
    const prisma = {
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue(record),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    }
    const passwords = {
      hash: jest.fn(),
      compare: jest.fn(async (plain: string, hash: string) => {
        return hash === LEGACY_BCRYPT_HASH && plain === 'good'
      }),
    }
    const users = {
      findByIdForAuth: jest.fn().mockResolvedValue({
        id: 'u1',
        role: 'STUDENT',
        isBlocked: false,
        universityId: null,
        facultyId: null,
        groupId: null,
        twoFactorEnabled: false,
        companyMembership: null,
      }),
    }
    const audit = { record: jest.fn() }
    const service = new AuthService(
      prisma as never,
      { sign: jest.fn(() => 'access') } as never,
      { get: jest.fn((k: string) => (k === 'JWT_REFRESH_EXPIRES_IN' ? '30d' : 0)) } as never,
      audit as never,
      passwords as unknown as PasswordService,
      users as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { assertAllowed: jest.fn() } as never,
      {} as never,
    )
    return { service, passwords, created, audit, tx }
  }

  const liveRecord = (tokenHash: string) => ({
    id: 'rt-1',
    userId: 'u1',
    familyId: 'fam-1',
    tokenHash,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000),
  })

  it('новый токен хранится SHA-256 секрета, bcrypt не вызывается', async () => {
    const { service, passwords, created } = setup(liveRecord(sha256('good')))

    const session = await service.refresh('rt-1.good', {})

    const secret = session.refreshToken.slice(session.refreshToken.indexOf('.') + 1)
    expect(session.refreshToken.startsWith('rt-new.')).toBe(true)
    expect(created[0]?.tokenHash).toBe(sha256(secret))
    expect(passwords.hash).not.toHaveBeenCalled()
    expect(passwords.compare).not.toHaveBeenCalled()
  })

  it('обычный обмен не пишет строку в AuditLog', async () => {
    const { service, audit } = setup(liveRecord(sha256('good')))
    await service.refresh('rt-1.good', {})
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('токен, выданный до перехода (bcrypt), принимается и меняется на SHA-256', async () => {
    const { service, passwords, created, tx } = setup(liveRecord(LEGACY_BCRYPT_HASH))

    const session = await service.refresh('rt-1.good', {})

    expect(passwords.compare).toHaveBeenCalledWith('good', LEGACY_BCRYPT_HASH)
    // Старый погашен, преемник уже в новом формате.
    expect(tx.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'rt-1' } }),
    )
    const secret = session.refreshToken.slice(session.refreshToken.indexOf('.') + 1)
    expect(created[0]?.tokenHash).toBe(sha256(secret))
  })

  it('bcrypt-запись с чужим секретом → 401', async () => {
    const { service } = setup(liveRecord(LEGACY_BCRYPT_HASH))
    await expect(service.refresh('rt-1.wrong', {})).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('сам хэш из БД вместо секрета не подходит', async () => {
    const stored = sha256('good')
    const { service } = setup(liveRecord(stored))
    await expect(service.refresh(`rt-1.${stored}`, {})).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })
})

// Окно грации меряется от прихода запроса: долгая сверка секрета не должна выталкивать честный
// повтор за окно (на раннере CI сравнение bcrypt-хэша занимало больше всего окна в 300 мс).
// Долгой сверка остаётся только у записей, выданных до перехода на SHA-256.
describe('AuthService: окно грации считается до сверки секрета', () => {
  it('повтор ротированного токена внутри окна не рвёт цепочку, даже если bcrypt долгий', async () => {
    let now = 1_000_000
    const dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      const record = {
        id: 'rt-1',
        userId: 'u1',
        familyId: 'fam-1',
        tokenHash: LEGACY_BCRYPT_HASH,
        revokedAt: new Date(now - 100), // ротирован 100 мс назад
        expiresAt: new Date(now + 86_400_000),
      }
      const prisma = {
        refreshToken: {
          findUnique: jest.fn().mockResolvedValue(record),
          count: jest.fn().mockResolvedValue(1), // преемник жив
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      }
      const passwords = {
        // Сравнение «идёт» 500 мс — дольше окна в 300 мс.
        compare: jest.fn(async (plain: string, hash: string) => {
          now += 500
          return hash === LEGACY_BCRYPT_HASH && plain === 'good'
        }),
      }
      const audit = { record: jest.fn() }
      // Дальше грации тест не идёт: пользователь «недоступен» — это отдельная ветка ответа.
      const users = { findByIdForAuth: jest.fn().mockResolvedValue(null) }
      const service = new AuthService(
        prisma as never,
        {} as never,
        { get: jest.fn((k: string) => (k === 'REFRESH_REUSE_GRACE_MS' ? 300 : 0)) } as never,
        audit as never,
        passwords as unknown as PasswordService,
        users as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        { assertAllowed: jest.fn() } as never,
        {} as never,
      )

      const err = await service.refresh('rt-1.good', {}).catch((e) => e)

      expect(passwords.compare).toHaveBeenCalled()
      expect(err.message).toBe('Учётная запись недоступна')
      expect(audit.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'refresh_reuse_detected' }),
      )
    } finally {
      dateSpy.mockRestore()
    }
  })
})
