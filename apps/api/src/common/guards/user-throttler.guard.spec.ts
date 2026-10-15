import type { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Reflector } from '@nestjs/core'
import type { ThrottlerStorage } from '@nestjs/throttler'
import type { EnvVars } from '../../config/env.schema'
import { UserThrottlerGuard } from './user-throttler.guard'

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
