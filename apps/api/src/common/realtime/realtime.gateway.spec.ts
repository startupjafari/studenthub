import type { ConfigService } from '@nestjs/config'
import type { JwtService } from '@nestjs/jwt'
import type { Server, Socket } from 'socket.io'
import type { EnvVars } from '../../config/env.schema'
import { RealtimeGateway } from './realtime.gateway'

// WS-аутентификация в handshake (план 9.8): без токена/с невалидным токеном — разрыв;
// с валидным — автоматический вход в свои комнаты и учёт присутствия.
function setup(enforceTwoFactor = true) {
  const jwt = { verifyAsync: jest.fn() }
  const prisma = { user: { update: jest.fn().mockResolvedValue({}) } }
  const config = { get: jest.fn(() => enforceTwoFactor) }
  const gateway = new RealtimeGateway(
    jwt as unknown as JwtService,
    prisma as unknown as import('../prisma/prisma.service').PrismaService,
    config as unknown as ConfigService<EnvVars, true>,
  )
  // Присутствие рассылается адресно: server.to(room).emit(...). Мокаем цепочку to→emit.
  const roomEmit = jest.fn()
  const server = { emit: jest.fn(), to: jest.fn(() => ({ emit: roomEmit })) }
  ;(gateway as unknown as { server: Server }).server = server as unknown as Server
  return { gateway, jwt, server, roomEmit }
}

function socket(token?: string): Socket {
  return {
    id: 'sock-1',
    handshake: { auth: token ? { token } : {}, headers: {} },
    data: {} as Record<string, unknown>,
    join: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as Socket
}

describe('RealtimeGateway — аутентификация handshake', () => {
  it('без токена — немедленный разрыв, без входа в комнаты и без онлайна', async () => {
    const { gateway, jwt } = setup()
    const client = socket()
    await gateway.handleConnection(client)
    expect(client.disconnect).toHaveBeenCalled()
    expect(client.join).not.toHaveBeenCalled()
    expect(jwt.verifyAsync).not.toHaveBeenCalled()
    expect(gateway.isOnline('u')).toBe(false)
  })

  it('невалидный/просроченный токен — разрыв', async () => {
    const { gateway, jwt } = setup()
    jwt.verifyAsync.mockRejectedValue(new Error('expired'))
    const client = socket('bad')
    await gateway.handleConnection(client)
    expect(client.disconnect).toHaveBeenCalled()
    expect(client.join).not.toHaveBeenCalled()
  })

  it('валидный токен — вход в user/group/university, онлайн и presence в комнату вуза', async () => {
    const { gateway, jwt, server, roomEmit } = setup()
    jwt.verifyAsync.mockResolvedValue({
      sub: 'u1',
      role: 'STUDENT',
      groupId: 'g1',
      universityId: 'uni1',
    })
    const client = socket('good')
    await gateway.handleConnection(client)
    expect(client.disconnect).not.toHaveBeenCalled()
    expect(client.join).toHaveBeenCalledWith('user:u1')
    expect(client.join).toHaveBeenCalledWith('group:g1')
    expect(client.join).toHaveBeenCalledWith('university:uni1')
    expect(client.data.userId).toBe('u1')
    expect(gateway.isOnline('u1')).toBe(true)
    // Присутствие адресно в комнату вуза, НЕ широковещательно (§9.3, регрессия cross-tenant).
    expect(server.emit).not.toHaveBeenCalled()
    expect(server.to).toHaveBeenCalledWith('university:uni1')
    expect(roomEmit).toHaveBeenCalledWith('presence:changed', { userId: 'u1', online: true })
  })

  it('без scope — личная комната, присутствие НЕ рассылается (нет вуза)', async () => {
    const { gateway, jwt, server, roomEmit } = setup()
    jwt.verifyAsync.mockResolvedValue({ sub: 'u2', role: 'PLATFORM_ADMIN', tfa: true })
    const client = socket('good')
    await gateway.handleConnection(client)
    expect(client.join).toHaveBeenCalledWith('user:u2')
    expect(client.join).toHaveBeenCalledTimes(1)
    expect(server.emit).not.toHaveBeenCalled()
    expect(roomEmit).not.toHaveBeenCalled()
  })

  it('auth:refresh с валидным токеном обновляет сессию без разрыва', async () => {
    const { gateway, jwt } = setup()
    jwt.verifyAsync.mockResolvedValue({ sub: 'u3', role: 'TEACHER' })
    const client = socket()
    await gateway.handleAuthRefresh(client, { token: 'new' })
    expect(client.data.userId).toBe('u3')
    expect(client.disconnect).not.toHaveBeenCalled()
  })

  it('auth:refresh с невалидным токеном не рвёт соединение', async () => {
    const { gateway, jwt } = setup()
    jwt.verifyAsync.mockRejectedValue(new Error('bad'))
    const client = socket()
    client.data.userId = 'prev'
    await gateway.handleAuthRefresh(client, { token: 'bad' })
    expect(client.disconnect).not.toHaveBeenCalled()
    expect(client.data.userId).toBe('prev')
  })
})

// Подписи мало: этим же секретом подписан промежуточный токен первого шага входа, а
// форс 2FA живёт в HTTP-guard'е, которого в handshake нет.
describe('RealtimeGateway — второй фактор в handshake', () => {
  it('challenge-токен 2FA (typ) не пускают в realtime', async () => {
    const { gateway, jwt } = setup()
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', typ: 'TWO_FACTOR' })
    const client = socket('challenge')
    await gateway.handleConnection(client)
    expect(client.disconnect).toHaveBeenCalled()
    expect(client.join).not.toHaveBeenCalled()
    expect(gateway.isOnline('u1')).toBe(false)
  })

  it('привилегированная роль без включённой 2FA — разрыв', async () => {
    const { gateway, jwt } = setup()
    jwt.verifyAsync.mockResolvedValue({ sub: 'd1', role: 'DEAN', universityId: 'uni1', tfa: false })
    const client = socket('good')
    await gateway.handleConnection(client)
    expect(client.disconnect).toHaveBeenCalled()
    expect(client.join).not.toHaveBeenCalled()
  })

  it('привилегированная роль с 2FA — пускают', async () => {
    const { gateway, jwt } = setup()
    jwt.verifyAsync.mockResolvedValue({ sub: 'd2', role: 'DEAN', universityId: 'uni1', tfa: true })
    const client = socket('good')
    await gateway.handleConnection(client)
    expect(client.disconnect).not.toHaveBeenCalled()
    expect(client.join).toHaveBeenCalledWith('user:d2')
  })

  it('обычная роль без 2FA — пускают (второй фактор ей не обязателен)', async () => {
    const { gateway, jwt } = setup()
    jwt.verifyAsync.mockResolvedValue({ sub: 's1', role: 'STUDENT', universityId: 'uni1' })
    const client = socket('good')
    await gateway.handleConnection(client)
    expect(client.disconnect).not.toHaveBeenCalled()
    expect(client.join).toHaveBeenCalledWith('user:s1')
  })

  it('TWO_FACTOR_ENFORCE=false — форс снят, typ всё равно отвергается', async () => {
    const { gateway, jwt } = setup(false)
    jwt.verifyAsync.mockResolvedValue({ sub: 'd3', role: 'DEAN', universityId: 'uni1', tfa: false })
    const client = socket('good')
    await gateway.handleConnection(client)
    expect(client.disconnect).not.toHaveBeenCalled()

    const { gateway: g2, jwt: j2 } = setup(false)
    j2.verifyAsync.mockResolvedValue({ sub: 'd3', typ: 'TWO_FACTOR' })
    const c2 = socket('challenge')
    await g2.handleConnection(c2)
    expect(c2.disconnect).toHaveBeenCalled()
  })

  it('auth:refresh challenge-токеном рвёт соединение, а не продлевает его', async () => {
    const { gateway, jwt } = setup()
    jwt.verifyAsync.mockResolvedValue({ sub: 'u9', typ: 'TWO_FACTOR' })
    const client = socket()
    client.data.userId = 'prev'
    await gateway.handleAuthRefresh(client, { token: 'challenge' })
    expect(client.disconnect).toHaveBeenCalled()
    expect(client.data.userId).toBe('prev')
  })
})
