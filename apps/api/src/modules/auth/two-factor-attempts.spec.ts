import type Redis from 'ioredis'
import type { JwtService } from '@nestjs/jwt'
import { AuthService } from './auth.service'
import type { TwoFactorService } from './two-factor.service'
import type { LoginAttemptsService } from './login-attempts.service'
import type { UserService } from '../users/users.service'

// Второй шаг входа: шестизначный код перебирается, а throttle на эндпоинте считает по IP
// и обходится сменой адреса. Пределы — счётчик на самом challenge и счётчик по пользователю.
describe('AuthService: попытки ввода кода 2FA', () => {
  const CHALLENGE = 'challenge-token'
  const JTI = 'jti-1'

  function setup(codeValid: boolean, shared?: Map<string, string>) {
    const store = shared ?? new Map<string, string>()
    const redis = {
      incr: jest.fn((key: string) => {
        const next = Number(store.get(key) ?? 0) + 1
        store.set(key, String(next))
        return Promise.resolve(next)
      }),
      expire: jest.fn().mockResolvedValue(1),
      set: jest.fn((key: string, value: string) => {
        if (store.has(key)) return Promise.resolve(null)
        store.set(key, value)
        return Promise.resolve('OK')
      }),
      exists: jest.fn((key: string) => Promise.resolve(store.has(key) ? 1 : 0)),
    }

    const jwt = {
      verify: jest.fn(() => ({ sub: 'user-1', typ: 'TWO_FACTOR', jti: JTI })),
      sign: jest.fn(() => 'access'),
    }

    const users = {
      getTwoFactorForLogin: jest.fn().mockResolvedValue({
        sub: 'user-1',
        id: 'user-1',
        role: 'STUDENT',
        twoFactorEnabled: true,
        isBlocked: false,
      }),
    }

    // Верный код — функция списания (для backup-кода — условная запись в БД).
    const consume = jest.fn().mockResolvedValue(true)
    const twoFactor = { checkCode: jest.fn().mockResolvedValue(codeValid ? consume : null) }
    // Счётчик по пользователю (BUG-076) — свой сервис со своими тестами; здесь важно,
    // что второй шаг его занимает и обнуляет.
    const loginAttempts = {
      beginAttempt: jest.fn().mockResolvedValue(undefined),
      reset: jest.fn().mockResolvedValue(undefined),
    }

    const service = new AuthService(
      {} as never,
      jwt as unknown as JwtService,
      { get: jest.fn() } as never,
      { record: jest.fn() } as never,
      {} as never,
      users as unknown as UserService,
      {} as never,
      twoFactor as unknown as TwoFactorService,
      loginAttempts as unknown as LoginAttemptsService,
      {} as never,
      redis as unknown as Redis,
      {} as never,
      { assertAllowed: jest.fn() } as never,
      // Компания работодателя подтверждена — вход не упирается в почту (D-F28).
      { loginDenial: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      { removeAllForUser: jest.fn() } as never,
    )
    // Выдача сессии — не предмет этого теста: она тянет Prisma и подпись токенов.
    const withPrivate = service as unknown as {
      issueSession: () => Promise<{ accessToken: string }>
    }
    const issueSession = jest
      .spyOn(withPrivate, 'issueSession')
      .mockResolvedValue({ accessToken: 'a' })

    return { service, redis, store, twoFactor, users, issueSession, consume, loginAttempts }
  }

  const verify = (service: AuthService) => service.loginVerifyTwoFactor(CHALLENGE, '000000', {})

  it('неверный код считается по challenge, а не молча', async () => {
    const { service, redis } = setup(false)

    await expect(verify(service)).rejects.toMatchObject({ code: 'INVALID_2FA_CODE' })

    expect(redis.incr).toHaveBeenCalledWith(`2fa:attempts:${JTI}`)
    expect(redis.expire).toHaveBeenCalledWith(`2fa:attempts:${JTI}`, 5 * 60)
  })

  it('окно счётчика ставится один раз, а не продлевается каждой попыткой', async () => {
    const { service, redis } = setup(false)

    for (let i = 0; i < 3; i++) await verify(service).catch(() => undefined)

    expect(redis.expire).toHaveBeenCalledTimes(1)
  })

  it('после трёх промахов challenge сгорает', async () => {
    const { service, store } = setup(false)

    for (let i = 0; i < 2; i++) await verify(service).catch(() => undefined)
    expect(store.has(`2fa:challenge:${JTI}`)).toBe(false)

    await verify(service).catch(() => undefined)
    expect(store.has(`2fa:challenge:${JTI}`)).toBe(true)
  })

  it('сгоревший challenge больше не обменивается на сессию даже с верным кодом', async () => {
    const { service, store } = setup(false)
    for (let i = 0; i < 3; i++) await verify(service).catch(() => undefined)

    // Тот же jti и тот же Redis, но код теперь верный: пометка «использован» уже стоит,
    // и SET NX в consumeChallengeId её не перебьёт — вход закрыт.
    const { service: second } = setup(true, store)

    await expect(second.loginVerifyTwoFactor(CHALLENGE, '111111', {})).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })

  // A-F11: раньше код проверялся до взгляда на challenge — верный backup-код после трёх
  // промахов списывался навсегда, а вход всё равно отвечал «уже использован».
  it('сгоревший challenge: код даже не проверяется, backup-код не списывается', async () => {
    const { service, store } = setup(false)
    for (let i = 0; i < 3; i++) await verify(service).catch(() => undefined)

    const second = setup(true, store)

    await expect(
      second.service.loginVerifyTwoFactor(CHALLENGE, 'ABCD1234', {}),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(second.twoFactor.checkCode).not.toHaveBeenCalled()
    expect(second.consume).not.toHaveBeenCalled()
    expect(second.users.getTwoFactorForLogin).not.toHaveBeenCalled()
  })

  it('backup-код списывается только после того, как challenge погашен', async () => {
    const { service, redis, consume } = setup(true)

    await expect(verify(service)).resolves.toMatchObject({ accessToken: 'a' })

    const challengeSet = redis.set.mock.invocationCallOrder[0] ?? Infinity
    expect(consume.mock.invocationCallOrder[0]).toBeGreaterThan(challengeSet)
  })

  it('backup-код ушёл параллельным входом → отказ, сессия не выдаётся', async () => {
    const { service, consume, issueSession } = setup(true)
    consume.mockResolvedValue(false)

    await expect(verify(service)).rejects.toMatchObject({ code: 'INVALID_2FA_CODE' })
    expect(issueSession).not.toHaveBeenCalled()
  })

  it('верный код с первой попытки счётчик не трогает', async () => {
    const { service, redis } = setup(true)

    await expect(verify(service)).resolves.toMatchObject({ accessToken: 'a' })

    expect(redis.incr).not.toHaveBeenCalled()
  })

  // BUG-076: счётчик на challenge обходится новым входом, лимиты входа — сменой IP.
  // Перебор кода по многим challenge останавливает счётчик по пользователю.
  it('код занимает попытку по пользователю до проверки', async () => {
    const { service, loginAttempts, twoFactor } = setup(false)

    await verify(service).catch(() => undefined)

    expect(loginAttempts.beginAttempt).toHaveBeenCalledWith('2fa:user-1')
    expect(loginAttempts.beginAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      twoFactor.checkCode.mock.invocationCallOrder[0] ?? 0,
    )
    expect(loginAttempts.reset).not.toHaveBeenCalled()
  })

  it('вход по пользователю закрыт → код не проверяется', async () => {
    const { service, loginAttempts, twoFactor } = setup(true)
    loginAttempts.beginAttempt.mockRejectedValue(
      Object.assign(new Error('locked'), { code: 'LOGIN_LOCKED' }),
    )

    await expect(verify(service)).rejects.toMatchObject({ code: 'LOGIN_LOCKED' })
    expect(twoFactor.checkCode).not.toHaveBeenCalled()
  })

  it('верный код обнуляет серию по пользователю', async () => {
    const { service, loginAttempts } = setup(true)

    await verify(service)

    expect(loginAttempts.reset).toHaveBeenCalledWith('2fa:user-1')
  })

  it('недоступный Redis не ломает второй шаг входа', async () => {
    const { service, redis } = setup(false)
    redis.incr.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(verify(service)).rejects.toMatchObject({ code: 'INVALID_2FA_CODE' })
  })

  // Регрессия: токен после второго шага нёс companyId: null, и работодатель с 2FA до
  // первого refresh получал «аккаунт не привязан к компании» на всех экранах карьеры.
  it('вход с 2FA сохраняет companyId работодателя в токене', async () => {
    const { service, users, issueSession } = setup(true)
    users.getTwoFactorForLogin.mockResolvedValue({
      id: 'user-1',
      role: 'EMPLOYER',
      universityId: null,
      facultyId: null,
      groupId: null,
      twoFactorEnabled: true,
      isBlocked: false,
      companyMembership: { companyId: 'company-1' },
    })

    await verify(service)

    expect(issueSession).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-1', role: 'EMPLOYER', companyId: 'company-1' }),
      expect.any(String),
    )
  })
})
