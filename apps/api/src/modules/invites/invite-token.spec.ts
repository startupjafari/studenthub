import { createHash, randomUUID } from 'node:crypto'
import { hashInviteToken, inviteTokenLookups } from './invite-token'

describe('invite-token', () => {
  it('хэш детерминирован и совпадает с sha256 от токена', () => {
    const raw = randomUUID()
    const expected = createHash('sha256').update(raw).digest('hex')
    expect(hashInviteToken(raw)).toBe(expected)
    expect(hashInviteToken(raw)).toBe(hashInviteToken(raw))
  })

  it('хэш не равен самому токену и имеет длину sha256', () => {
    const raw = randomUUID()
    const hash = hashInviteToken(raw)
    expect(hash).not.toBe(raw)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('разные токены дают разные хэши', () => {
    expect(hashInviteToken(randomUUID())).not.toBe(hashInviteToken(randomUUID()))
  })

  // Фолбэк переходный: приглашения, выданные до перехода на хэш, лежат в базе открытым
  // текстом, и без второго значения ссылки в уже отправленных письмах перестали бы работать.
  it('для поиска отдаёт сначала хэш, следом сам токен', () => {
    const raw = 'legacy-plain-token'
    expect(inviteTokenLookups(raw)).toEqual([hashInviteToken(raw), raw])
  })
})
