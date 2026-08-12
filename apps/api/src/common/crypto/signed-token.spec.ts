import { signToken, verifyToken, type SignedPayload } from './signed-token'

interface Demo extends SignedPayload {
  sub: string
}

const SECRET = 'test-secret-at-least-32-characters-long!!'
const NOW = 1_000_000

describe('signed-token', () => {
  it('подписывает и верифицирует валидный токен', () => {
    const token = signToken<Demo>({ sub: 'u1', exp: NOW + 1000 }, SECRET)
    const res = verifyToken<Demo>(token, SECRET, NOW)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.payload.sub).toBe('u1')
  })

  it('отклоняет истёкший токен', () => {
    const token = signToken<Demo>({ sub: 'u1', exp: NOW - 1 }, SECRET)
    const res = verifyToken<Demo>(token, SECRET, NOW)
    expect(res).toEqual({ ok: false, reason: 'expired' })
  })

  it('отклоняет подделанную подпись (другой секрет)', () => {
    const token = signToken<Demo>({ sub: 'u1', exp: NOW + 1000 }, SECRET)
    const res = verifyToken<Demo>(token, 'another-secret-at-least-32-characters!!', NOW)
    expect(res).toEqual({ ok: false, reason: 'invalid' })
  })

  it('отклоняет изменённый payload', () => {
    const token = signToken<Demo>({ sub: 'u1', exp: NOW + 1000 }, SECRET)
    const tampered = `${Buffer.from(JSON.stringify({ sub: 'hacker', exp: NOW + 1000 })).toString(
      'base64url',
    )}.${token.split('.')[1]}`
    const res = verifyToken<Demo>(tampered, SECRET, NOW)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('invalid')
  })

  it('отклоняет некорректный формат', () => {
    expect(verifyToken('not-a-token', SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyToken('', SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' })
  })
})
