import type { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { QrLoginService } from './qr-login.service'
import type { QrLoginGateway } from './qr-login.gateway'
import type { EnvVars } from '../../config/env.schema'

// Мок Redis: обычная Map (TTL игнорируем — в тестах не истекает). NX/XX соблюдаются:
// на них держится «подтверждает ровно один».
function makeRedis() {
  const store = new Map<string, string>()
  return {
    store,
    set: jest.fn(async (k: string, v: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(k)) return null
      if (args.includes('XX') && !store.has(k)) return null
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
    expect(res.qr.startsWith('data:image/svg+xml;base64,')).toBe(true)
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

  // Подмена сессии: второй, видевший QR, подтверждал его своим аккаунтом, и десктоп
  // входил под чужим. Подтверждение — одно; повтор другим → 409, userId прежний.
  it('повторный approve другим пользователем → CONFLICT, сессия остаётся за первым', async () => {
    const { service, redis, gateway } = setup()
    const { qrId, claimSecret } = await service.create()
    const approveToken = await approveTokenOf(redis, qrId)

    await service.approve(approveToken, 'victim')
    await expect(service.approve(approveToken, 'attacker')).rejects.toMatchObject({
      code: 'CONFLICT',
    })

    expect(gateway.emitApproved).toHaveBeenCalledTimes(1)
    await expect(service.claim(qrId, claimSecret)).resolves.toBe('victim')
  })

  it('повторное нажатие тем же пользователем — не ошибка', async () => {
    const { service, redis } = setup()
    const { qrId } = await service.create()
    const approveToken = await approveTokenOf(redis, qrId)

    await service.approve(approveToken, 'user-1')
    await expect(service.approve(approveToken, 'user-1')).resolves.toBeUndefined()
  })

  it('два одновременных approve разными людьми — проходит ровно один', async () => {
    const { service, redis } = setup()
    const { qrId, claimSecret } = await service.create()
    const approveToken = await approveTokenOf(redis, qrId)

    const results = await Promise.allSettled([
      service.approve(approveToken, 'a'),
      service.approve(approveToken, 'b'),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const winner = results[0]?.status === 'fulfilled' ? 'a' : 'b'
    await expect(service.claim(qrId, claimSecret)).resolves.toBe(winner)
  })

  it('approve истёкшей сессии не воскрешает её', async () => {
    const { service, redis } = setup()
    const { qrId } = await service.create()
    const approveToken = await approveTokenOf(redis, qrId)
    redis.ttl.mockResolvedValueOnce(-2)

    await expect(service.approve(approveToken, 'user-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

describe('QrLoginService — кто просит вход', () => {
  const CHROME_WIN =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

  it('preview показывает браузер, ОС и сеть инициатора, IP замаскирован', async () => {
    const { service, redis } = setup()
    const { qrId } = await service.create({ ip: '203.0.113.57', userAgent: CHROME_WIN })
    const preview = await service.preview(await approveTokenOf(redis, qrId))
    expect(preview.requester).toEqual({ browser: 'Chrome', os: 'Windows', ip: '203.0.113.x' })
  })

  it('после подтверждения preview недоступен', async () => {
    const { service, redis } = setup()
    const { qrId } = await service.create({ ip: '203.0.113.57', userAgent: CHROME_WIN })
    const token = await approveTokenOf(redis, qrId)
    await service.approve(token, 'u1')
    await expect(service.preview(token)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('claim забирает ровно один: второй параллельный — NOT_FOUND', async () => {
    const { service, redis } = setup()
    const { qrId, claimSecret } = await service.create()
    await service.approve(await approveTokenOf(redis, qrId), 'u1')
    const results = await Promise.allSettled([
      service.claim(qrId, claimSecret),
      service.claim(qrId, claimSecret),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  })
})
