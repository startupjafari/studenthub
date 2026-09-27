import type Redis from 'ioredis'
import { LoginAttemptsService } from './login-attempts.service'
import { AppException } from '../../common/exceptions/app.exception'

// Счётчик неудачных входов по учётной записи: защита от перебора одного аккаунта с многих
// адресов, которую лимит по IP не даёт в принципе.
describe('LoginAttemptsService', () => {
  /** Минимальный Redis в памяти: хватает incr/expire/ttl/set/del, которыми сервис и пользуется. */
  function fakeRedis() {
    const values = new Map<string, string>()
    const expiry = new Map<string, number>()
    return {
      values,
      expiry,
      incr: jest.fn((key: string) => {
        const next = Number(values.get(key) ?? 0) + 1
        values.set(key, String(next))
        return Promise.resolve(next)
      }),
      expire: jest.fn((key: string, seconds: number) => {
        expiry.set(key, seconds)
        return Promise.resolve(1)
      }),
      ttl: jest.fn((key: string) =>
        Promise.resolve(values.has(key) ? (expiry.get(key) ?? -1) : -2),
      ),
      set: jest.fn((key: string, value: string, _mode?: string, seconds?: number) => {
        values.set(key, value)
        if (seconds) expiry.set(key, seconds)
        return Promise.resolve('OK')
      }),
      del: jest.fn((key: string) => {
        values.delete(key)
        expiry.delete(key)
        return Promise.resolve(1)
      }),
    }
  }

  const make = (redis: ReturnType<typeof fakeRedis>) =>
    new LoginAttemptsService(redis as unknown as Redis)

  it('не блокирует, пока порог не достигнут', async () => {
    const redis = fakeRedis()
    const service = make(redis)

    for (let i = 0; i < 9; i++) await service.registerFailure('student@vuz.kz')

    await expect(service.assertNotLocked('student@vuz.kz')).resolves.toBeUndefined()
  })

  it('на десятой неудаче закрывает вход', async () => {
    const redis = fakeRedis()
    const service = make(redis)

    for (let i = 0; i < 10; i++) await service.registerFailure('student@vuz.kz')

    await expect(service.assertNotLocked('student@vuz.kz')).rejects.toBeInstanceOf(AppException)
    await expect(service.assertNotLocked('student@vuz.kz')).rejects.toMatchObject({
      code: 'LOGIN_LOCKED',
    })
  })

  it('блокировка нарастает: вторая серия ждёт дольше первой', async () => {
    const redis = fakeRedis()
    const service = make(redis)

    for (let i = 0; i < 10; i++) await service.registerFailure('a@vuz.kz')
    const firstLock = [...redis.expiry.entries()].find(([k]) => k.startsWith('login:lock:'))?.[1]

    for (let i = 0; i < 10; i++) await service.registerFailure('a@vuz.kz')
    const secondLock = [...redis.expiry.entries()].find(([k]) => k.startsWith('login:lock:'))?.[1]

    expect(firstLock).toBe(5 * 60)
    expect(secondLock).toBe(15 * 60)
  })

  it('окно продлевается только первой неудачей — иначе счётчик не сбросится никогда', async () => {
    const redis = fakeRedis()
    const service = make(redis)

    await service.registerFailure('a@vuz.kz')
    await service.registerFailure('a@vuz.kz')
    await service.registerFailure('a@vuz.kz')

    const failExpires = redis.expire.mock.calls.filter(([key]) =>
      String(key).startsWith('login:fail:'),
    )
    expect(failExpires).toHaveLength(1)
  })

  it('успешный вход обнуляет серию', async () => {
    const redis = fakeRedis()
    const service = make(redis)

    for (let i = 0; i < 9; i++) await service.registerFailure('a@vuz.kz')
    await service.reset('a@vuz.kz')
    for (let i = 0; i < 9; i++) await service.registerFailure('a@vuz.kz')

    await expect(service.assertNotLocked('a@vuz.kz')).resolves.toBeUndefined()
  })

  it('разные аккаунты считаются раздельно', async () => {
    const redis = fakeRedis()
    const service = make(redis)

    for (let i = 0; i < 10; i++) await service.registerFailure('a@vuz.kz')

    await expect(service.assertNotLocked('b@vuz.kz')).resolves.toBeUndefined()
  })

  it('идентификатор нормализуется: регистр и пробелы не дают обойти счётчик', async () => {
    const redis = fakeRedis()
    const service = make(redis)

    for (let i = 0; i < 5; i++) await service.registerFailure('Student@Vuz.KZ')
    for (let i = 0; i < 5; i++) await service.registerFailure('  student@vuz.kz ')

    await expect(service.assertNotLocked('STUDENT@VUZ.KZ')).rejects.toMatchObject({
      code: 'LOGIN_LOCKED',
    })
  })

  it('в Redis не попадает сам идентификатор — только его хэш', async () => {
    const redis = fakeRedis()
    const service = make(redis)

    await service.registerFailure('student@vuz.kz')

    const keys = [...redis.values.keys()]
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.some((k) => k.includes('student@vuz.kz'))).toBe(false)
  })

  it('недоступный Redis не ломает вход', async () => {
    const redis = fakeRedis()
    const down = new Error('ECONNREFUSED')
    redis.incr.mockRejectedValue(down)
    redis.ttl.mockRejectedValue(down)
    redis.del.mockRejectedValue(down)
    const service = make(redis)

    await expect(service.assertNotLocked('a@vuz.kz')).resolves.toBeUndefined()
    await expect(service.registerFailure('a@vuz.kz')).resolves.toBeUndefined()
    await expect(service.reset('a@vuz.kz')).resolves.toBeUndefined()
  })
})
