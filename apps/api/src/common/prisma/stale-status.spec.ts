import { Prisma } from '@prisma/client'
import { rethrowStaleStatus } from './stale-status'

describe('rethrowStaleStatus', () => {
  it('P2025 (статус успели сменить) → CONFLICT', () => {
    const e = new Prisma.PrismaClientKnownRequestError('not found', {
      code: 'P2025',
      clientVersion: 'test',
    })
    expect(() => rethrowStaleStatus(e)).toThrow(expect.objectContaining({ code: 'CONFLICT' }))
  })

  it('прочие ошибки пробрасываются как есть', () => {
    const e = new Error('db down')
    expect(() => rethrowStaleStatus(e)).toThrow(e)
  })
})
