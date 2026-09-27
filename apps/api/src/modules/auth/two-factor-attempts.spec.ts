import type Redis from 'ioredis'
import type { JwtService } from '@nestjs/jwt'
import { AuthService } from './auth.service'
import type { TwoFactorService } from './two-factor.service'
import type { LoginAttemptsService } from './login-attempts.service'
import type { UserService } from '../users/users.service'

// Второй шаг входа: шестизначный код перебирается, а throttle на эндпоинте считает по IP
// и обходится сменой адреса. Единственный настоящий предел — счётчик на самом challenge.
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

    const twoFactor = { verifyCode: jest.fn().mockResolvedValue(codeValid) }

    const service = new AuthService(
      {} as never,
      jwt as unknown as JwtService,
      { get: jest.fn() } as never,
      { record: jest.fn() } as never,
      {} as never,
      users as unknown as UserService,
      {} as never,
      twoFactor as unknown as TwoFactorService,
      {} as unknown as LoginAttemptsService,
      {} as never,
      redis as unknown as Redis,
    )
    // Выдача сессии — не предмет этого теста: она тянет Prisma и подпись токенов.
    jest
      .spyOn(service as unknown as { issueSession: () => unknown }, 'issueSession')
      .mockResolvedValue({ accessToken: 'a', refreshToken: 'r', refreshExpiresAt: new Date() })

    return { service, redis, store, twoFactor }
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

  it('верный код с первой попытки счётчик не трогает', async () => {
    const { service, redis } = setup(true)

    await expect(verify(service)).resolves.toMatchObject({ accessToken: 'a' })

    expect(redis.incr).not.toHaveBeenCalled()
  })

  it('недоступный Redis не ломает второй шаг входа', async () => {
    const { service, redis } = setup(false)
    redis.incr.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(verify(service)).rejects.toMatchObject({ code: 'INVALID_2FA_CODE' })
  })
})
