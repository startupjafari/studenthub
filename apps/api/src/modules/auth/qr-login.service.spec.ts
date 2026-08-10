import type { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { QrLoginService } from './qr-login.service'
import type { QrLoginGateway } from './qr-login.gateway'
import type { EnvVars } from '../../config/env.schema'

// Мок Redis: обычная Map (TTL игнорируем — в тестах не истекает).
function makeRedis() {
  const store = new Map<string, string>()
  return {
    store,
    set: jest.fn(async (k: string, v: string) => {
      store.set(k, v)
      return 'OK'
    }),
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    del: jest.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
    ttl: jest.fn(async () => 100),
  }
}

function setup() {
  const redis = makeRedis()
  const config = { get: jest.fn().mockReturnValue('http://localhost:3000') }
  const gateway = { emitApproved: jest.fn() }
  const service = new QrLoginService(
    redis as unknown as Redis,
    config as unknown as ConfigService<EnvVars, true>,
    gateway as unknown as QrLoginGateway,
  )
  return { service, redis, gateway }
}

// approveToken лежит в состоянии Redis (в ответе create его нет — только в QR).
async function approveTokenOf(redis: ReturnType<typeof makeRedis>, qrId: string): Promise<string> {
  return JSON.parse(redis.store.get(`qrlogin:${qrId}`)!).approveToken
}

describe('QrLoginService', () => {
  it('create: возвращает qrId, QR(data-url) и claimSecret; approveToken в QR НЕ в ответе', async () => {
    const { service } = setup()
    const res = await service.create()
    expect(res.qrId).toBeTruthy()
    expect(res.claimSecret).toBeTruthy()
    expect(res.qr.startsWith('data:image/png;base64,')).toBe(true)
    expect(res).not.toHaveProperty('approveToken')
  })

  it('полный флоу: create → approve → claim возвращает userId и эмитит WS', async () => {
    const { service, redis, gateway } = setup()
    const { qrId, claimSecret } = await service.create()
    const approveToken = await approveTokenOf(redis, qrId)

    await service.approve(approveToken, 'user-1')
    expect(gateway.emitApproved).toHaveBeenCalledWith(qrId)

    const userId = await service.claim(qrId, claimSecret)
    expect(userId).toBe('user-1')
  })

  it('claim до approve → BAD_REQUEST', async () => {
    const { service, redis } = setup()
    const { qrId, claimSecret } = await service.create()
    void redis
    await expect(service.claim(qrId, claimSecret)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('claim с неверным claimSecret → UNAUTHORIZED', async () => {
    const { service, redis } = setup()
    const { qrId } = await service.create()
    const approveToken = await approveTokenOf(redis, qrId)
    await service.approve(approveToken, 'user-1')
    await expect(service.claim(qrId, 'wrong')).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('claim одноразовый: повтор после успешного → NOT_FOUND', async () => {
    const { service, redis } = setup()
    const { qrId, claimSecret } = await service.create()
    const approveToken = await approveTokenOf(redis, qrId)
    await service.approve(approveToken, 'user-1')
    await service.claim(qrId, claimSecret)
    await expect(service.claim(qrId, claimSecret)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('approve с неизвестным токеном → NOT_FOUND', async () => {
    const { service } = setup()
    await expect(service.approve('nope', 'user-1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
