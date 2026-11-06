import type Redis from 'ioredis'
import { LoginAttemptsService } from './login-attempts.service'
import { AppException } from '../../common/exceptions/app.exception'

// Счётчик неудачных входов по учётной записи: защита от перебора одного аккаунта с многих
// адресов, которую лимит по IP не даёт в принципе.
describe('LoginAttemptsService', () => {
  /** Минимальный Redis в памяти: хватает incr/expire/ttl/get/set/del, которыми сервис и пользуется. */
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
      get: jest.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
      set: jest.fn((key: string, value: string, _mode?: string, seconds?: number, nx?: string) => {
        if (nx === 'NX' && values.has(key)) return Promise.resolve(null)
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

  /** n неудачных попыток подряд: попытка занята, пароль не подошёл. */
  async function fail(service: LoginAttemptsService, identifier: string, n: number) {
    for (let i = 0; i < n; i++) await service.beginAttempt(identifier)
  }

  it('десять попыток проходят, одиннадцатая — LOGIN_LOCKED', async () => {
    const redis = fakeRedis()
    const service = make(redis)

    await fail(service, 'student@vuz.kz', 10)

    await expect(service.beginAttempt('student@vuz.kz')).rejects.toMatchObject({
      code: 'LOGIN_LOCKED',
    })
  })

  it('после десяти неудач вход закрыт и с верным паролем', async () => {
    const redis = fakeRedis()
    const service = make(redis)

    await fail(service, 'student@vuz.kz', 10)
    await service.beginAttempt('student@vuz.kz').catch(() => undefined)

    await expect(service.beginAttempt('student@vuz.kz')).rejects.toBeInstanceOf(AppException)
    await expect(service.beginAttempt('student@vuz.kz')).rejects.toMatchObject({
      code: 'LOGIN_LOCKED',
    })
  })

  // BUG-077: попытка занимается до сверки пароля — сотня одновременных запросов не видит
  // пустой счётчик, и паролей проверяется ровно столько, сколько позволяет порог.
  it('параллельная пачка не проскакивает порог', async () => {
    const redis = fakeRedis()
    const service = make(redis)

    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () => service.beginAttempt('a@vuz.kz')),
    )

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10)
    // Блокировка одна, а не по штуке на каждый запрос сверх порога.
    expect([...redis.values.entries()].find(([k]) => k.startsWith('login:locks:'))?.[1]).toBe('1')
  })

  it('блокировка нарастает: вторая серия ждёт дольше первой', async () => {
    const redis = fakeRedis()
    const service = make(redis)

    await fail(service, 'a@vuz.kz', 10)
    await service.beginAttempt('a@vuz.kz').catch(() => undefined)
    const firstLock = [...redis.expiry.entries()].find(([k]) => k.startsWith('login:lock:'))?.[1]

    // Блокировка истекла — новая серия.
    const lockKey = [...redis.values.keys()].find((k) => k.startsWith('login:lock:'))!
    redis.values.delete(lockKey)
    redis.expiry.delete(lockKey)
    await fail(service, 'a@vuz.kz', 10)
    await service.beginAttempt('a@vuz.kz').catch(() => undefined)
    const secondLock = [...redis.expiry.entries()].find(([k]) => k.startsWith('login:lock:'))?.[1]

    expect(firstLock).toBe(5 * 60)
    expect(secondLock).toBe(15 * 60)
  })

  it('окно продлевается только первой попыткой — иначе счётчик не сбросится никогда', async () => {
    const redis = fakeRedis()
    const service = make(redis)

    await fail(service, 'a@vuz.kz', 3)

    const failExpires = redis.expire.mock.calls.filter(([key]) =>
      String(key).startsWith('login:fail:'),
    )
    expect(failExpires).toHaveLength(1)
  })

  it('успешный вход обнуляет серию', async () => {
    const redis = fakeRedis()
    const service = make(redis)

    await fail(service, 'a@vuz.kz', 9)
    await service.reset('a@vuz.kz')
    await fail(service, 'a@vuz.kz', 10)

    await expect(service.beginAttempt('a@vuz.kz')).rejects.toMatchObject({ code: 'LOGIN_LOCKED' })
    expect([...redis.values.keys()].some((k) => k.startsWith('login:lock:'))).toBe(true)
  })

  it('разные аккаунты считаются раздельно', async () => {
    const redis = fakeRedis()
    const service = make(redis)

    await fail(service, 'a@vuz.kz', 10)
    await service.beginAttempt('a@vuz.kz').catch(() => undefined)

    await expect(service.beginAttempt('b@vuz.kz')).resolves.toBeUndefined()
  })

  it('идентификатор нормализуется: регистр и пробелы не дают обойти счётчик', async () => {
    const redis = fakeRedis()
    const service = make(redis)

    await fail(service, 'Student@Vuz.KZ', 5)
    await fail(service, '  student@vuz.kz ', 5)

    await expect(service.beginAttempt('STUDENT@VUZ.KZ')).rejects.toMatchObject({
      code: 'LOGIN_LOCKED',
    })
  })

  it('в Redis не попадает сам идентификатор — только его хэш', async () => {
    const redis = fakeRedis()
    const service = make(redis)

    await service.beginAttempt('student@vuz.kz')

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

    await expect(service.beginAttempt('a@vuz.kz')).resolves.toBeUndefined()
    await expect(service.reset('a@vuz.kz')).resolves.toBeUndefined()
  })
})
