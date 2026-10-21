import type { ExecutionContext } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Reflector } from '@nestjs/core'
import { ThrottlerException } from '@nestjs/throttler'
import type { ThrottlerStorage } from '@nestjs/throttler'
import type { EnvVars } from '../../config/env.schema'
import { AuthThrottle, UserThrottlerGuard } from './user-throttler.guard'

const SECRET = 's'.repeat(32)

function make() {
  const config = { get: jest.fn().mockReturnValue(SECRET) }
  const guard = new UserThrottlerGuard(
    { throttlers: [{ ttl: 60_000, limit: 100 }] },
    {} as ThrottlerStorage,
    new Reflector(),
    config as unknown as ConfigService<EnvVars, true>,
  )
  const track = (req: Record<string, unknown>) =>
    (guard as unknown as { getTracker: (r: unknown) => Promise<string> }).getTracker(req)
  return { track }
}

const sign = (payload: object, secret = SECRET) =>
  new JwtService({ secret }).sign(payload as Record<string, unknown>)

describe('UserThrottlerGuard — трекер', () => {
  it('с валидным access-токеном считает по пользователю, а не по IP кампуса', async () => {
    const { track } = make()
    const req = { ip: '10.0.0.1', headers: { authorization: `Bearer ${sign({ sub: 'u1' })}` } }
    await expect(track(req)).resolves.toBe('user:u1')
  })

  it('поддельная подпись → по IP: подменой sub лимит не обойти', async () => {
    const { track } = make()
    const forged = sign({ sub: 'u-random' }, 'x'.repeat(32))
    const req = { ip: '10.0.0.1', headers: { authorization: `Bearer ${forged}` } }
    await expect(track(req)).resolves.toBe('10.0.0.1')
  })

  it('промежуточный токен 2FA и запрос без токена → по IP', async () => {
    const { track } = make()
    const challenge = sign({ sub: 'u1', typ: 'TWO_FACTOR' })
    await expect(
      track({ ip: '10.0.0.2', headers: { authorization: `Bearer ${challenge}` } }),
    ).resolves.toBe('10.0.0.2')
    await expect(track({ ip: '10.0.0.3', headers: {} })).resolves.toBe('10.0.0.3')
  })
})

// Публичные auth-маршруты: кампус за NAT — один адрес на всех (A-F02). Лимиты в тестовом
// контроллере нарочно маленькие: свой счётчик — 2, потолок с адреса — 4.
class AuthRoutes {
  @AuthThrottle('login', { limit: 2, ttl: 60_000 }, { limit: 4, ttl: 60_000 })
  login() {}

  @AuthThrottle('login-2fa', { limit: 2, ttl: 60_000 }, { limit: 4, ttl: 60_000 })
  loginVerify() {}

  @AuthThrottle('refresh', { limit: 2, ttl: 60_000 }, { limit: 4, ttl: 60_000 })
  refresh() {}

  @AuthThrottle('invite-param', { limit: 2, ttl: 60_000 }, { limit: 4, ttl: 60_000 })
  preview() {}

  plain() {}
}

// Счётчики в памяти с той же семантикой, что у Redis-хранилища: блок, когда попаданий больше лимита.
function memoryStorage(): ThrottlerStorage {
  const hits = new Map<string, number>()
  return {
    increment: async (key: string, ttl: number, limit: number) => {
      const totalHits = (hits.get(key) ?? 0) + 1
      hits.set(key, totalHits)
      const isBlocked = totalHits > limit
      return {
        totalHits,
        timeToExpire: ttl / 1000,
        isBlocked,
        timeToBlockExpire: isBlocked ? ttl / 1000 : 0,
      }
    },
  }
}

async function makeGuard() {
  const config = { get: jest.fn().mockReturnValue(SECRET) }
  const guard = new UserThrottlerGuard(
    { throttlers: [{ ttl: 60_000, limit: 100 }] },
    memoryStorage(),
    new Reflector(),
    config as unknown as ConfigService<EnvVars, true>,
  )
  await guard.onModuleInit()
  const hit = (handler: keyof AuthRoutes, req: Record<string, unknown>) =>
    guard.canActivate({
      getHandler: () => AuthRoutes.prototype[handler],
      getClass: () => AuthRoutes,
      switchToHttp: () => ({
        getRequest: () => ({ headers: {}, ...req }),
        getResponse: () => ({ header: jest.fn() }),
      }),
    } as unknown as ExecutionContext)
  return { hit }
}

const CAMPUS_IP = '10.0.0.1'

describe('UserThrottlerGuard — публичные auth-маршруты (@AuthThrottle)', () => {
  it('вход: счёт на пару «адрес + логин» без учёта регистра, соседи по NAT не мешают', async () => {
    const { hit } = await makeGuard()
    const login = (identifier: string) =>
      hit('login', { ip: CAMPUS_IP, body: { identifier, password: 'x' } })

    await expect(login('Ivanov@Uni.kz')).resolves.toBe(true)
    await expect(login(' ivanov@uni.kz ')).resolves.toBe(true)
    // Третья попытка к той же учётке — свой лимит исчерпан, регистр его не обходит.
    await expect(login('IVANOV@UNI.KZ')).rejects.toBeInstanceOf(ThrottlerException)
    // Сосед по кампусу входит в свою учётку, хотя адрес тот же.
    await expect(login('petrov@uni.kz')).resolves.toBe(true)
  })

  it('вход: потолок с адреса не даёт перебирать логины подменой идентификатора', async () => {
    const { hit } = await makeGuard()
    for (const n of [1, 2, 3, 4]) {
      await expect(
        hit('login', { ip: CAMPUS_IP, body: { identifier: `user${n}@uni.kz` } }),
      ).resolves.toBe(true)
    }
    await expect(
      hit('login', { ip: CAMPUS_IP, body: { identifier: 'user5@uni.kz' } }),
    ).rejects.toBeInstanceOf(ThrottlerException)
    // Другой адрес — свой потолок.
    await expect(
      hit('login', { ip: '10.0.0.2', body: { identifier: 'user5@uni.kz' } }),
    ).resolves.toBe(true)
  })

  it('2FA: ключ — владелец проверенного challenge; поддельный считается только потолком', async () => {
    const { hit } = await makeGuard()
    const challenge = sign({ sub: 'u1', typ: 'TWO_FACTOR' })
    const verify = (challengeToken: string) =>
      hit('loginVerify', { ip: CAMPUS_IP, body: { challengeToken, code: '000000' } })

    await expect(verify(challenge)).resolves.toBe(true)
    await expect(verify(sign({ sub: 'u1', typ: 'TWO_FACTOR' }))).resolves.toBe(true)
    // Новый challenge той же учётки счётчик не сбрасывает.
    await expect(verify(sign({ sub: 'u1', typ: 'TWO_FACTOR' }))).rejects.toBeInstanceOf(
      ThrottlerException,
    )
    // Подделка подписи свежего счётчика не даёт — её держит потолок с адреса. Отбитая своим
    // лимитом попытка потолок не тратит: на нём пока два попадания из четырёх.
    const forged = () => verify(sign({ sub: 'u-random', typ: 'TWO_FACTOR' }, 'x'.repeat(32)))
    await expect(forged()).resolves.toBe(true)
    await expect(forged()).resolves.toBe(true)
    await expect(forged()).rejects.toBeInstanceOf(ThrottlerException)
  })

  it('refresh: счёт по id токена из cookie, вкладки кампуса не делят лимит на всех', async () => {
    const { hit } = await makeGuard()
    const refresh = (cookie?: string) =>
      hit('refresh', { ip: CAMPUS_IP, cookies: cookie ? { sh_refresh: cookie } : {} })

    await expect(refresh('tok-a.secret1')).resolves.toBe(true)
    await expect(refresh('tok-a.secret2')).resolves.toBe(true)
    await expect(refresh('tok-a.secret3')).rejects.toBeInstanceOf(ThrottlerException)
    // Другая сессия с того же адреса — свой счётчик (пока не упёрлись в потолок).
    await expect(refresh('tok-b.secret')).resolves.toBe(true)
  })

  it('refresh без cookie считается только потолком с адреса', async () => {
    const { hit } = await makeGuard()
    for (let i = 0; i < 4; i += 1) {
      await expect(hit('refresh', { ip: CAMPUS_IP, cookies: {} })).resolves.toBe(true)
    }
    await expect(hit('refresh', { ip: CAMPUS_IP, cookies: {} })).rejects.toBeInstanceOf(
      ThrottlerException,
    )
  })

  it('предпросмотр инвайта: счёт по токену из пути', async () => {
    const { hit } = await makeGuard()
    const preview = (token: string) => hit('preview', { ip: CAMPUS_IP, params: { token } })

    await expect(preview('invite-1')).resolves.toBe(true)
    await expect(preview('invite-1')).resolves.toBe(true)
    await expect(preview('invite-1')).rejects.toBeInstanceOf(ThrottlerException)
    await expect(preview('invite-2')).resolves.toBe(true)
  })

  it('маршрут без @AuthThrottle считается по-прежнему — общим лимитом', async () => {
    const { hit } = await makeGuard()
    for (let i = 0; i < 100; i += 1) {
      await expect(hit('plain', { ip: CAMPUS_IP })).resolves.toBe(true)
    }
    await expect(hit('plain', { ip: CAMPUS_IP })).rejects.toBeInstanceOf(ThrottlerException)
  })
})
