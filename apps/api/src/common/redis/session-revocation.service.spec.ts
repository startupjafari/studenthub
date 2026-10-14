import type { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import type { EnvVars } from '../../config/env.schema'
import { SessionRevocationService } from './session-revocation.service'

function setup(get: jest.Mock = jest.fn().mockResolvedValue(null)) {
  const redis = { set: jest.fn().mockResolvedValue('OK'), get }
  const config = { get: jest.fn().mockReturnValue('15m') }
  const service = new SessionRevocationService(
    redis as unknown as Redis,
    config as unknown as ConfigService<EnvVars, true>,
  )
  return { service, redis }
}

describe('SessionRevocationService', () => {
  it('метка живёт срок access-токена с запасом', async () => {
    const { service, redis } = setup()
    await service.revokeIssuedBefore('u1', new Date(1_000_000))
    expect(redis.set).toHaveBeenCalledWith('auth:revoked-before:u1', '1000', 'EX', 15 * 60 + 60)
  })

  it('токен старше метки отозван, новее — нет', async () => {
    const { service } = setup(jest.fn().mockResolvedValue('1000'))
    await expect(service.isRevoked('u1', 999)).resolves.toBe(true)
    await expect(service.isRevoked('u1', 1000)).resolves.toBe(false)
  })

  it('без метки и при сбое Redis — пропускаем', async () => {
    await expect(setup().service.isRevoked('u1', 1)).resolves.toBe(false)
    const broken = setup(jest.fn().mockRejectedValue(new Error('down')))
    await expect(broken.service.isRevoked('u1', 1)).resolves.toBe(false)
  })

  it('подвисший Redis не держит запрос', async () => {
    const { service } = setup(jest.fn(() => new Promise(() => undefined)))
    await expect(service.isRevoked('u1', 1)).resolves.toBe(false)
  })
})
