import { Role } from '@studenthub/shared-types'
import { CameraViewsService, MAX_ACTIVE_VIEWS } from './camera-views.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { CameraDemand } from './camera-demand'
import type { CameraAgentSignal } from './camera-agent-signal'
import type { MediaTokenService } from './media-token.service'

// Просмотр камер: кто может, сколько одновременно и как он гаснет при выключении. Токен
// ретранслятора выдаётся только на путь своей камеры.

const ctx = { ip: '10.0.0.1', userAgent: 'jest' }

function actor(role: Role, universityId: string | null = 'uni-1', sub = 'u-1'): JwtPayload {
  return { sub, role, universityId, facultyId: null, groupId: null }
}
const guard = actor(Role.SECURITY_GUARD)

function setup(
  options: { relay?: boolean; enabled?: boolean; cameraEnabled?: boolean; active?: number } = {},
) {
  const prisma = {
    camera: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'cam-1',
        name: 'Вход',
        universityId: 'uni-1',
        agentId: 'agent-1',
        enabled: options.cameraEnabled ?? true,
      }),
    },
    cameraSettings: {
      findUnique: jest.fn().mockResolvedValue({ enabled: options.enabled ?? true }),
    },
    cameraViewSession: {
      count: jest.fn().mockResolvedValue(options.active ?? 0),
      create: jest.fn().mockResolvedValue({ id: 'view-1' }),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ firstName: 'Ерлан', lastName: 'Тестов' }) },
  }
  const tokens = {
    relaySettings: jest.fn(() =>
      options.relay === false
        ? null
        : { hlsUrl: 'https://media.kz', publishUrl: 'rtmps://r:1936', caPem: 'PEM' },
    ),
    sign: jest.fn(() => 'jwt'),
  }
  const demand = {
    mark: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  }
  const signal = { bump: jest.fn().mockResolvedValue(undefined) }
  const service = new CameraViewsService(
    prisma as unknown as PrismaService,
    tokens as unknown as MediaTokenService,
    demand as unknown as CameraDemand,
    signal as unknown as CameraAgentSignal,
  )
  return { service, prisma, tokens, demand, signal }
}

describe('CameraViewsService', () => {
  it('охрана начинает просмотр: журнал, спрос, сигнал агенту, токен только на эту камеру', async () => {
    const { service, prisma, tokens, demand, signal } = setup()
    const ticket = await service.start(guard, 'cam-1', ctx)
    expect(ticket).toMatchObject({
      sessionId: 'view-1',
      hlsUrl: 'https://media.kz/cam/cam-1/index.m3u8',
      token: 'jwt',
      expiresInSec: 120,
      heartbeatInSec: 30,
    })
    expect(prisma.cameraViewSession.create.mock.calls[0][0].data).toMatchObject({
      universityId: 'uni-1',
      cameraId: 'cam-1',
      cameraName: 'Вход',
      userId: 'u-1',
      userName: 'Тестов Ерлан',
      ip: '10.0.0.1',
    })
    expect(tokens.sign).toHaveBeenCalledWith(
      'user:u-1',
      [{ action: 'read', path: 'cam/cam-1' }],
      120,
    )
    expect(demand.mark).toHaveBeenCalledWith('cam-1')
    expect(signal.bump).toHaveBeenCalledWith('agent-1')
  })

  it('камера чужого вуза — NOT_FOUND', async () => {
    const { service } = setup()
    await expect(
      service.start(actor(Role.SECURITY_GUARD, 'uni-2'), 'cam-1', ctx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('остальным ролям просмотр закрыт', async () => {
    const { service } = setup()
    for (const role of [Role.DEAN, Role.TEACHER, Role.STUDENT, Role.PLATFORM_ADMIN]) {
      await expect(service.start(actor(role), 'cam-1', ctx)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
    }
  })

  it.each([
    [{ relay: false }, 'relay'],
    [{ enabled: false }, 'module'],
    [{ cameraEnabled: false }, 'camera'],
    [{ active: MAX_ACTIVE_VIEWS }, 'views'],
  ])('отказ %o — CONFLICT с полем %s, сессия не создаётся', async (options, field) => {
    const { service, prisma } = setup(options)
    await expect(service.start(guard, 'cam-1', ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: [expect.objectContaining({ field })],
    })
    expect(prisma.cameraViewSession.create).not.toHaveBeenCalled()
  })

  it('продление — свежий токен и спрос', async () => {
    const { service, prisma, demand } = setup()
    prisma.cameraViewSession.findUnique.mockResolvedValue({
      id: 'view-1',
      cameraId: 'cam-1',
      userId: 'u-1',
      endedAt: null,
    })
    const ticket = await service.heartbeat(guard, 'view-1')
    expect(ticket.token).toBe('jwt')
    expect(prisma.cameraViewSession.update.mock.calls[0][0].data).toEqual({
      lastSeenAt: expect.any(Date),
    })
    expect(demand.mark).toHaveBeenCalledWith('cam-1')
  })

  it('модуль выключили — продление закрывает сессию и токена не даёт', async () => {
    const { service, prisma, tokens } = setup({ enabled: false })
    prisma.cameraViewSession.findUnique.mockResolvedValue({
      id: 'view-1',
      cameraId: 'cam-1',
      userId: 'u-1',
      endedAt: null,
    })
    await expect(service.heartbeat(guard, 'view-1')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(prisma.cameraViewSession.update.mock.calls[0][0].data).toEqual({
      endedAt: expect.any(Date),
    })
    expect(tokens.sign).not.toHaveBeenCalled()
  })

  it('последний зритель закончил — спрос снят и агент разбужен сразу', async () => {
    const { service, prisma, demand, signal } = setup({ active: 0 })
    prisma.cameraViewSession.findUnique.mockResolvedValue({
      id: 'view-1',
      cameraId: 'cam-1',
      userId: 'u-1',
      endedAt: null,
    })
    await service.end(guard, 'view-1')
    expect(demand.clear).toHaveBeenCalledWith('cam-1')
    expect(signal.bump).toHaveBeenCalledWith('agent-1')
  })

  it('камеру ещё смотрит кто-то другой — поток не гасится', async () => {
    const { service, prisma, demand } = setup({ active: 1 })
    prisma.cameraViewSession.findUnique.mockResolvedValue({
      id: 'view-1',
      cameraId: 'cam-1',
      userId: 'u-1',
      endedAt: null,
    })
    await service.end(guard, 'view-1')
    expect(demand.clear).not.toHaveBeenCalled()
  })

  it('чужую или закрытую сессию не продлить', async () => {
    const { service, prisma } = setup()
    prisma.cameraViewSession.findUnique.mockResolvedValue({
      id: 'view-1',
      cameraId: 'cam-1',
      userId: 'someone-else',
      endedAt: null,
    })
    await expect(service.heartbeat(guard, 'view-1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    prisma.cameraViewSession.findUnique.mockResolvedValue({
      id: 'view-1',
      cameraId: 'cam-1',
      userId: 'u-1',
      endedAt: new Date(),
    })
    await expect(service.heartbeat(guard, 'view-1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
