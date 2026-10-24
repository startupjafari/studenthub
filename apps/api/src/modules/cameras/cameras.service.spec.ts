import { generateKeyPairSync, type JsonWebKey } from 'node:crypto'
import { Role } from '@studenthub/shared-types'
import { CamerasService } from './cameras.service'
import { CameraAgentsService, agentConnection } from './camera-agents.service'
import { hashAgentToken } from './agent-token'
import { open } from '../../common/crypto/sealed-box'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RoomService } from '../rooms/rooms.service'
import type { CameraAgentSignal } from './camera-agent-signal'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

function actor(role: Role, universityId: string | null = 'uni-1'): JwtPayload {
  return { sub: 'u-1', role, universityId, facultyId: null, groupId: null }
}

const admin = actor(Role.UNIVERSITY_ADMIN)
const guard = actor(Role.SECURITY_GUARD)

function agentKeys() {
  const pair = generateKeyPairSync('x25519')
  return {
    publicRaw: pair.publicKey.export({ format: 'jwk' }).x as string,
    privateJwk: pair.privateKey.export({ format: 'jwk' }) as JsonWebKey,
  }
}

function cameraRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cam-1',
    name: 'Вход, корпус А',
    agentId: 'agent-1',
    streamUrl: 'rtsp://10.0.0.5:554/Streaming/Channels/102',
    credentialsSealed: null,
    enabled: true,
    status: 'UNKNOWN',
    lastSeenAt: null,
    createdAt: new Date(),
    agent: { id: 'agent-1', name: 'Корпус А' },
    room: null,
    ...overrides,
  }
}

function setup(agentPublicKey: string | null = null) {
  const prisma = {
    camera: {
      findMany: jest.fn().mockResolvedValue([cameraRow()]),
      count: jest.fn().mockResolvedValue(1),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    cameraAgent: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({
        id: 'agent-1',
        universityId: 'uni-1',
        publicKey: agentPublicKey,
      }),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    cameraSettings: { findUnique: jest.fn(), upsert: jest.fn() },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const rooms = { assertRoomInUniversity: jest.fn().mockResolvedValue(undefined) }
  const signal = {
    bump: jest.fn().mockResolvedValue(undefined),
    bumpUniversity: jest.fn().mockResolvedValue(undefined),
  }
  const agents = new CameraAgentsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    signal as unknown as CameraAgentSignal,
  )
  const service = new CamerasService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    agents,
    rooms as unknown as RoomService,
    signal as unknown as CameraAgentSignal,
  )
  return { service, agents, prisma, audit, rooms, signal }
}

describe('CamerasService', () => {
  describe('список', () => {
    it('охране — только включённые камеры своего вуза и без адреса потока', async () => {
      const { service, prisma } = setup()
      const page = await service.list(guard, { page: 1, limit: 20 })
      expect(prisma.camera.findMany.mock.calls[0][0].where).toEqual({
        universityId: 'uni-1',
        enabled: true,
      })
      expect(page.items[0]).not.toHaveProperty('streamUrl')
      expect(page.items[0]).not.toHaveProperty('agent')
    })

    it('админу — все камеры с адресом, но без пароля и конверта', async () => {
      const { service, prisma } = setup()
      prisma.camera.findMany.mockResolvedValue([cameraRow({ credentialsSealed: 'v1.x.y.z.w' })])
      const page = await service.list(admin, { page: 1, limit: 20 })
      expect(prisma.camera.findMany.mock.calls[0][0].where).toEqual({ universityId: 'uni-1' })
      expect(page.items[0]).toMatchObject({ streamUrl: expect.any(String), hasCredentials: true })
      expect(JSON.stringify(page.items)).not.toContain('v1.x.y.z.w')
    })

    it('«В сети» — только пока агент на связи и модуль включён', async () => {
      const { service, prisma } = setup()
      const fresh = { id: 'agent-1', name: 'Корпус А', lastSeenAt: new Date() }
      const stale = { ...fresh, lastSeenAt: new Date(Date.now() - 10 * 60_000) }
      prisma.camera.findMany.mockResolvedValue([
        cameraRow({ id: 'cam-1', status: 'ONLINE', agent: fresh }),
        cameraRow({ id: 'cam-2', status: 'ONLINE', agent: stale }),
      ])
      prisma.cameraSettings.findUnique.mockResolvedValue({ enabled: true })
      const page = await service.list(guard, { page: 1, limit: 20 })
      expect(page.items.map((c) => c.status)).toEqual(['ONLINE', 'UNKNOWN'])

      prisma.cameraSettings.findUnique.mockResolvedValue({ enabled: false })
      const off = await service.list(guard, { page: 1, limit: 20 })
      expect(off.items.map((c) => c.status)).toEqual(['UNKNOWN', 'UNKNOWN'])
    })

    it('остальным ролям камер не видно', async () => {
      const { service } = setup()
      for (const role of [Role.DEAN, Role.TEACHER, Role.STUDENT, Role.PLATFORM_ADMIN]) {
        await expect(service.list(actor(role), { page: 1, limit: 20 })).rejects.toMatchObject({
          code: 'FORBIDDEN',
        })
      }
    })
  })

  describe('добавление', () => {
    it('пароль ложится конвертом, который вскрывает только ключ агента', async () => {
      const { publicRaw, privateJwk } = agentKeys()
      const { service, prisma } = setup(publicRaw)
      prisma.camera.create.mockImplementation(async ({ data }) => cameraRow(data))
      await service.create(
        admin,
        {
          agentId: 'agent-1',
          name: 'Вход',
          streamUrl: 'rtsp://10.0.0.5/Streaming/Channels/102',
          credentials: { username: 'admin', password: 'Секрет 1' },
        },
        ctx,
      )
      const data = prisma.camera.create.mock.calls[0][0].data
      expect(data.credentialsSealed).not.toContain('Секрет')
      expect(JSON.parse(open(data.credentialsSealed, privateJwk, data.id))).toEqual({
        username: 'admin',
        password: 'Секрет 1',
      })
    })

    it('пароль для агента, не приславшего ключ, — CONFLICT AGENT_NOT_READY', async () => {
      const { service, prisma } = setup(null)
      await expect(
        service.create(
          admin,
          {
            agentId: 'agent-1',
            name: 'Вход',
            streamUrl: 'rtsp://10.0.0.5/x',
            credentials: { username: 'admin', password: 'p' },
          },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' })
      expect(prisma.camera.create).not.toHaveBeenCalled()
    })

    it('камеру без пароля можно добавить и к агенту без ключа', async () => {
      const { service, prisma } = setup(null)
      prisma.camera.create.mockImplementation(async ({ data }) => cameraRow(data))
      await service.create(
        admin,
        { agentId: 'agent-1', name: 'Вход', streamUrl: 'rtsp://h/x' },
        ctx,
      )
      expect(prisma.camera.create.mock.calls[0][0].data.credentialsSealed).toBeNull()
    })

    it('агент чужого вуза — NOT_FOUND', async () => {
      const { service, prisma } = setup('k')
      prisma.cameraAgent.findUnique.mockResolvedValue({
        id: 'agent-9',
        universityId: 'uni-2',
        publicKey: null,
      })
      await expect(
        service.create(admin, { agentId: 'agent-9', name: 'x', streamUrl: 'rtsp://h/x' }, ctx),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('помещение проверяется на принадлежность вузу', async () => {
      const { service, prisma, rooms } = setup(null)
      prisma.camera.create.mockImplementation(async ({ data }) => cameraRow(data))
      await service.create(
        admin,
        { agentId: 'agent-1', name: 'x', streamUrl: 'rtsp://h/x', roomId: 'room-1' },
        ctx,
      )
      expect(rooms.assertRoomInUniversity).toHaveBeenCalledWith('room-1', 'uni-1')
    })

    it('охрана камеры не добавляет', async () => {
      const { service } = setup('k')
      await expect(
        service.create(guard, { agentId: 'agent-1', name: 'x', streamUrl: 'rtsp://h/x' }, ctx),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })
  })

  describe('правка', () => {
    it('credentials: null убирает пароль; в журнал — только имена полей', async () => {
      const { service, prisma, audit } = setup()
      prisma.camera.findUnique.mockResolvedValue({
        id: 'cam-1',
        universityId: 'uni-1',
        agentId: 'agent-1',
      })
      prisma.camera.update.mockResolvedValue(cameraRow())
      await service.update(admin, 'cam-1', { credentials: null }, ctx)
      expect(prisma.camera.update.mock.calls[0][0].data).toMatchObject({
        credentialsSealed: null,
        status: 'UNKNOWN',
      })
      expect(audit.record.mock.calls[0][0].metadata.fields).toEqual(['credentials'])
    })

    it('камера чужого вуза — NOT_FOUND', async () => {
      const { service, prisma } = setup()
      prisma.camera.findUnique.mockResolvedValue({
        id: 'cam-9',
        universityId: 'uni-2',
        agentId: 'agent-9',
      })
      await expect(service.update(admin, 'cam-9', { name: 'x' }, ctx)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })
  })

  describe('выключатель', () => {
    it('по умолчанию камеры выключены', async () => {
      const { service, prisma } = setup()
      prisma.cameraSettings.findUnique.mockResolvedValue(null)
      await expect(service.settings(guard)).resolves.toEqual({ enabled: false })
    })

    it('переключает только админ, с записью в журнал', async () => {
      const { service, prisma, audit } = setup()
      prisma.cameraSettings.upsert.mockResolvedValue({ enabled: false })
      await service.updateSettings(admin, { enabled: false }, ctx)
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'cameras_disabled', entityId: 'uni-1' }),
      )
      await expect(service.updateSettings(guard, { enabled: true }, ctx)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
    })
  })
})

describe('CameraAgentsService', () => {
  it('токен отдаётся один раз, в базе — только его хэш', async () => {
    const { agents, prisma } = setup()
    prisma.cameraAgent.create.mockImplementation(async ({ data }) => ({
      id: 'agent-1',
      name: data.name,
      publicKey: null,
      version: null,
      lastSeenAt: null,
      createdAt: new Date(),
      _count: { cameras: 0 },
    }))
    const { token, agent } = await agents.create(admin, { name: 'Корпус А' }, ctx)
    const stored = prisma.cameraAgent.create.mock.calls[0][0].data
    expect(token).toMatch(/^shca_/)
    expect(stored.tokenHash).toBe(hashAgentToken(token))
    expect(JSON.stringify(stored)).not.toContain(token)
    expect(agent).toMatchObject({ connection: 'NEVER', ready: false })
  })

  it('перевыпуск токена сбрасывает ключ агента и конверты паролей его камер', async () => {
    const { agents, prisma } = setup('k')
    prisma.cameraAgent.update.mockResolvedValue({
      id: 'agent-1',
      name: 'А',
      publicKey: null,
      version: null,
      lastSeenAt: null,
      createdAt: new Date(),
      _count: { cameras: 2 },
    })
    await agents.rotateToken(admin, 'agent-1', ctx)
    expect(prisma.cameraAgent.update.mock.calls[0][0].data).toMatchObject({
      publicKey: null,
      lastSeenAt: null,
    })
    expect(prisma.camera.updateMany).toHaveBeenCalledWith({
      where: { agentId: 'agent-1' },
      data: { credentialsSealed: null, status: 'UNKNOWN' },
    })
  })

  it('агенты видит и заводит только админ вуза', async () => {
    const { agents } = setup()
    await expect(agents.list(guard)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      agents.create(actor(Role.PLATFORM_ADMIN, null), { name: 'x' }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('на связи — если отчитывался за последние полторы минуты', () => {
    const now = Date.now()
    expect(agentConnection(null, now)).toBe('NEVER')
    expect(agentConnection(new Date(now - 30_000), now)).toBe('ONLINE')
    expect(agentConnection(new Date(now - 5 * 60_000), now)).toBe('OFFLINE')
  })
})
