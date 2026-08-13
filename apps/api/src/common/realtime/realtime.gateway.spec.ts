import type { JwtService } from '@nestjs/jwt'
import type { Server, Socket } from 'socket.io'
import { RealtimeGateway } from './realtime.gateway'

// WS-аутентификация в handshake (план 9.8): без токена/с невалидным токеном — разрыв;
// с валидным — автоматический вход в свои комнаты и учёт присутствия.
function setup() {
  const jwt = { verifyAsync: jest.fn() }
  const gateway = new RealtimeGateway(jwt as unknown as JwtService)
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
    jwt.verifyAsync.mockResolvedValue({ sub: 'u2', role: 'PLATFORM_ADMIN' })
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
