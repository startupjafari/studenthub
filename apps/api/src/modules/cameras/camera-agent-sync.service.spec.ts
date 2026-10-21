import { CameraAgentSyncService } from './camera-agent-sync.service'
import type { CameraAgentSignal } from './camera-agent-signal'
import type { AgentPrincipal } from './agent-auth.guard'
import type { PrismaService } from '../../common/prisma/prisma.service'

// Синхронизация агента: единственный вход в API без пользователя. Тесты закрывают, что
// агент не перехватит чужие камеры и чужой ключ, и что длинный опрос отдаёт изменение
// сразу, а не по таймауту.

const KEY_A = 'A'.repeat(43)
const KEY_B = 'B'.repeat(43)

function setup(options: { publicKey?: string | null; enabled?: boolean } = {}) {
  const agent: AgentPrincipal = {
    id: 'agent-1',
    universityId: 'uni-1',
    publicKey: options.publicKey === undefined ? null : options.publicKey,
  }
  const cameras = [{ id: 'cam-1', streamUrl: 'rtsp://h/1', credentialsSealed: null }]
  const prisma = {
    cameraAgent: { update: jest.fn().mockResolvedValue({}) },
    camera: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue(cameras),
    },
    cameraSettings: {
      findUnique: jest.fn().mockResolvedValue({ enabled: options.enabled ?? true }),
    },
  }
  let counter = 0
  const signal = { current: jest.fn(async () => String(counter)) }
  const service = new CameraAgentSyncService(
    prisma as unknown as PrismaService,
    signal as unknown as CameraAgentSignal,
  )
  return {
    service,
    agent,
    prisma,
    cameras,
    bump: () => {
      counter += 1
    },
  }
}

const input = (extra: Record<string, unknown> = {}) => ({
  version: '1.0.0',
  publicKey: KEY_A,
  cameras: [],
  ...extra,
})

describe('CameraAgentSyncService', () => {
  it('первый ключ агента принимается и запоминается', async () => {
    const { service, agent, prisma } = setup()
    await service.sync(agent, input(), 0)
    expect(prisma.cameraAgent.update.mock.calls[0][0].data).toMatchObject({
      publicKey: KEY_A,
      version: '1.0.0',
      lastSeenAt: expect.any(Date),
    })
  })

  it('другой ключ при известном — 409 KEY_MISMATCH, ничего не меняется', async () => {
    const { service, agent, prisma } = setup({ publicKey: KEY_A })
    await expect(service.sync(agent, input({ publicKey: KEY_B }), 0)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(prisma.cameraAgent.update).not.toHaveBeenCalled()
  })

  it('статусы пишутся только камерам этого агента', async () => {
    const { service, agent, prisma } = setup({ publicKey: KEY_A })
    await service.sync(
      agent,
      input({
        cameras: [
          { id: 'cam-1', status: 'ONLINE' },
          { id: 'cam-of-other-agent', status: 'ONLINE' },
          { id: 'cam-2', status: 'AUTH_FAILED' },
        ],
      }),
      0,
    )
    for (const [args] of prisma.camera.updateMany.mock.calls) {
      expect(args.where.agentId).toBe('agent-1')
    }
    const online = prisma.camera.updateMany.mock.calls.find(([a]) => a.data.status === 'ONLINE')![0]
    expect(online.data.lastSeenAt).toBeInstanceOf(Date)
  })

  it('модуль выключен — агенту пустой список камер', async () => {
    const { service, agent, prisma } = setup({ publicKey: KEY_A, enabled: false })
    const res = await service.sync(agent, input(), 0)
    expect(res).toMatchObject({ enabled: false, cameras: [] })
    expect(prisma.camera.findMany).not.toHaveBeenCalled()
  })

  it('выдаёт только включённые камеры агента, с конвертом, но без названий и вуза', async () => {
    const { service, agent, prisma } = setup({ publicKey: KEY_A })
    const res = await service.sync(agent, input(), 0)
    expect(prisma.camera.findMany.mock.calls[0][0].where).toEqual({
      agentId: 'agent-1',
      enabled: true,
    })
    expect(res.cameras[0]).toEqual({
      id: 'cam-1',
      streamUrl: 'rtsp://h/1',
      credentialsSealed: null,
    })
  })

  it('другая ревизия у агента — ответ сразу', async () => {
    const { service, agent } = setup({ publicKey: KEY_A })
    const started = Date.now()
    const res = await service.sync(agent, input({ revision: 'old' }), 5_000)
    expect(Date.now() - started).toBeLessThan(500)
    expect(res.revision).not.toBe('old')
  })

  it('та же ревизия — ждёт и отдаёт изменение, как только оно случилось', async () => {
    const { service, agent, cameras, bump } = setup({ publicKey: KEY_A })
    const { revision } = await service.config(agent)
    setTimeout(() => {
      cameras.push({ id: 'cam-2', streamUrl: 'rtsp://h/2', credentialsSealed: null })
      bump()
    }, 300)
    const started = Date.now()
    const res = await service.sync(agent, input({ revision }), 10_000)
    expect(Date.now() - started).toBeLessThan(3_000)
    expect(res.revision).not.toBe(revision)
    expect(res.cameras).toHaveLength(2)
  })

  it('та же ревизия и без изменений — та же конфигурация по таймауту', async () => {
    const { service, agent } = setup({ publicKey: KEY_A })
    const { revision } = await service.config(agent)
    const res = await service.sync(agent, input({ revision }), 1_200)
    expect(res.revision).toBe(revision)
  })
})
