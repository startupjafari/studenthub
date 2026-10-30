import type { ConfigService } from '@nestjs/config'
import type { JwtService } from '@nestjs/jwt'
import type { Server, Socket } from 'socket.io'
import type { EnvVars } from '../../config/env.schema'
import { RealtimeGateway } from './realtime.gateway'
import { UniversityAccessService } from '../../modules/universities/university-access.service'
import type { PrismaService } from '../prisma/prisma.service'

// WS-аутентификация в handshake (план 9.8): без токена/с невалидным токеном — разрыв;
// с валидным — автоматический вход в свои комнаты и учёт присутствия.
function setup(enforceTwoFactor = true) {
  const jwt = { verifyAsync: jest.fn() }
  const prisma = {
    user: { update: jest.fn().mockResolvedValue({}) },
    // Статус вуза читает настоящий UniversityAccessService — тот же, что у HTTP.
    university: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
  }
  const universityAccess = new UniversityAccessService(prisma as unknown as PrismaService)
  const config = { get: jest.fn(() => enforceTwoFactor) }
  const revocation = { isRevoked: jest.fn().mockResolvedValue(false) }
  const gateway = new RealtimeGateway(
    jwt as unknown as JwtService,
    prisma as unknown as import('../prisma/prisma.service').PrismaService,
    config as unknown as ConfigService<EnvVars, true>,
    revocation as unknown as import('../redis/session-revocation.service').SessionRevocationService,
    universityAccess,
  )
  // Присутствие рассылается адресно: server.to(rooms).emit(...). Мокаем цепочку to→emit.
  const roomEmit = jest.fn()
  const server = { emit: jest.fn(), to: jest.fn(() => ({ emit: roomEmit })) }
  ;(gateway as unknown as { server: Server }).server = server as unknown as Server
  return { gateway, jwt, server, roomEmit, revocation, prisma, universityAccess }
}

/** Дать отработать отложенной рассылке присутствия (аудитория читается асинхронно). */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

function socket(token?: string): Socket {
  return {
    id: 'sock-1',
    handshake: { auth: token ? { token } : {}, headers: {} },
    data: {} as Record<string, unknown>,
    connected: true,
    join: jest.fn(),
    leave: jest.fn(),
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

  it('валидный токен — вход в user/group/university, онлайн и presence адресатам', async () => {
    const { gateway, jwt, server, roomEmit } = setup()
    const audience = jest.fn().mockResolvedValue(['user:u5', 'chat:c1'])
    gateway.setPresenceAudience(audience)
    jwt.verifyAsync.mockResolvedValue({
      sub: 'u1',
      role: 'STUDENT',
      groupId: 'g1',
      universityId: 'uni1',
    })
    const client = socket('good')
    await gateway.handleConnection(client)
    await flush()
    expect(client.disconnect).not.toHaveBeenCalled()
    expect(client.join).toHaveBeenCalledWith('user:u1')
    expect(client.join).toHaveBeenCalledWith('group:g1')
    expect(client.join).toHaveBeenCalledWith('university:uni1')
    expect(client.data.userId).toBe('u1')
    expect(gateway.isOnline('u1')).toBe(true)
    // Присутствие — собеседникам и открытым чатам, НЕ широковещательно (§9.3, cross-tenant)
    // и НЕ всему вузу (F-F12: каждый вход/выход стоил отправки каждому подключённому).
    expect(audience).toHaveBeenCalledWith('u1')
    expect(server.emit).not.toHaveBeenCalled()
    expect(server.to).toHaveBeenCalledTimes(1)
    expect(server.to).toHaveBeenCalledWith(['user:u5', 'chat:c1'])
    expect(roomEmit).toHaveBeenCalledWith('presence:changed', { userId: 'u1', online: true })
  })

  it('последнее соединение закрыто — адресатам уходит «не в сети»', async () => {
    const { gateway, jwt, roomEmit } = setup()
    gateway.setPresenceAudience(jest.fn().mockResolvedValue(['user:u5']))
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', role: 'STUDENT', universityId: 'uni1' })
    const first = socket('good')
    const second = socket('good')
    await gateway.handleConnection(first)
    await gateway.handleConnection(second)
    await flush()
    // Вторая вкладка — не переход: рассылки нет.
    expect(roomEmit).toHaveBeenCalledTimes(1)

    gateway.handleDisconnect(first)
    await flush()
    expect(roomEmit).toHaveBeenCalledTimes(1)

    gateway.handleDisconnect(second)
    await flush()
    expect(roomEmit).toHaveBeenLastCalledWith('presence:changed', { userId: 'u1', online: false })
  })

  // Аудитория читается из базы асинхронно: «подключился — сразу отключился» не должен
  // оставить человека «в сети» у собеседника, если ответы базы пришли в обратном порядке.
  it('шлёт состояние на момент отправки, а не перехода', async () => {
    const { gateway, jwt, roomEmit } = setup()
    let release: (rooms: string[]) => void = () => undefined
    const audience = jest
      .fn()
      .mockImplementationOnce(() => new Promise<string[]>((resolve) => (release = resolve)))
      .mockResolvedValue(['user:u5'])
    gateway.setPresenceAudience(audience)
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', role: 'STUDENT', universityId: 'uni1' })
    const client = socket('good')
    await gateway.handleConnection(client)
    gateway.handleDisconnect(client)
    await flush()
    release(['user:u5'])
    await flush()

    expect(roomEmit).toHaveBeenCalledTimes(2)
    for (const call of roomEmit.mock.calls) {
      expect(call).toEqual(['presence:changed', { userId: 'u1', online: false }])
    }
  })

  it('сбой чтения аудитории соединение не роняет и ничего не рассылает', async () => {
    const { gateway, jwt, roomEmit } = setup()
    gateway.setPresenceAudience(jest.fn().mockRejectedValue(new Error('db down')))
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', role: 'STUDENT', universityId: 'uni1' })
    const client = socket('good')
    await gateway.handleConnection(client)
    await flush()
    expect(client.disconnect).not.toHaveBeenCalled()
    expect(gateway.isOnline('u1')).toBe(true)
    expect(roomEmit).not.toHaveBeenCalled()
  })

  it('без scope — личная комната, присутствие НЕ рассылается (нет вуза)', async () => {
    const { gateway, jwt, server, roomEmit } = setup()
    const audience = jest.fn().mockResolvedValue(['user:u5'])
    gateway.setPresenceAudience(audience)
    jwt.verifyAsync.mockResolvedValue({ sub: 'u2', role: 'PLATFORM_ADMIN', tfa: true })
    const client = socket('good')
    await gateway.handleConnection(client)
    await flush()
    expect(client.join).toHaveBeenCalledWith('user:u2')
    expect(client.join).toHaveBeenCalledTimes(1)
    expect(audience).not.toHaveBeenCalled()
    expect(server.emit).not.toHaveBeenCalled()
    expect(roomEmit).not.toHaveBeenCalled()
  })

  it('auth:refresh с валидным токеном обновляет сессию без разрыва', async () => {
    const { gateway, jwt } = setup()
    jwt.verifyAsync.mockResolvedValue({ sub: 'u3', role: 'TEACHER' })
    const client = socket()
    client.data.userId = 'u3'
    client.data.role = 'STUDENT'
    await gateway.handleAuthRefresh(client, { token: 'new' })
    expect(client.data.userId).toBe('u3')
    expect(client.data.role).toBe('TEACHER')
    expect(client.disconnect).not.toHaveBeenCalled()
  })

  // F-F18: чужой токен раньше подменял userId — комнаты оставались прежнего владельца,
  // а разрыв списывал онлайн другого человека.
  it('auth:refresh токеном другого пользователя рвёт соединение и не подменяет его', async () => {
    const { gateway, jwt } = setup()
    gateway.setPresenceAudience(jest.fn().mockResolvedValue([]))
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', role: 'STUDENT', universityId: 'uni1' })
    const client = socket('good')
    await gateway.handleConnection(client)

    jwt.verifyAsync.mockResolvedValue({ sub: 'intruder', role: 'STUDENT' })
    await gateway.handleAuthRefresh(client, { token: 'someone-else' })

    expect(client.disconnect).toHaveBeenCalled()
    expect(client.data.userId).toBe('u1')
    // Разрыв списывает онлайн владельца соединения, а не того, чей токен прислали.
    gateway.handleDisconnect(client)
    expect(gateway.isOnline('u1')).toBe(false)
    expect(gateway.isOnline('intruder')).toBe(false)
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

// F-F18: между началом handleConnection и учётом соединения — несколько await, и клиент
// успевает отвалиться. Раньше счётчик всё равно уходил в +1: «в сети» до рестарта процесса.
describe('RealtimeGateway — гонка подключения и разрыва', () => {
  it('отвалился, пока проверяли токен, — ни комнат, ни онлайна', async () => {
    const { gateway, jwt, roomEmit } = setup()
    gateway.setPresenceAudience(jest.fn().mockResolvedValue(['user:u5']))
    const client = socket('good')
    jwt.verifyAsync.mockImplementation(async () => {
      // Разрыв приходит посреди проверки: socket.io уже вызвал handleDisconnect.
      ;(client as unknown as { connected: boolean }).connected = false
      gateway.handleDisconnect(client)
      return { sub: 'u1', role: 'STUDENT', universityId: 'uni1' }
    })

    await gateway.handleConnection(client)
    await flush()

    expect(gateway.isOnline('u1')).toBe(false)
    expect(client.join).not.toHaveBeenCalled()
    expect(roomEmit).not.toHaveBeenCalled()
  })

  it('отвалился во время входа в комнаты — комнаты освобождаются, онлайна нет', async () => {
    const { gateway, jwt } = setup()
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', role: 'STUDENT', universityId: 'uni1' })
    const client = socket('good')
    ;(client.join as jest.Mock).mockImplementation(async () => {
      ;(client as unknown as { connected: boolean }).connected = false
    })

    await gateway.handleConnection(client)

    expect(gateway.isOnline('u1')).toBe(false)
    expect(client.leave).toHaveBeenCalledWith('user:u1')
    expect(client.leave).toHaveBeenCalledWith('university:uni1')
  })

  it('разрыв неучтённого соединения не уводит в офлайн другую вкладку', async () => {
    const { gateway, jwt } = setup()
    gateway.setPresenceAudience(jest.fn().mockResolvedValue([]))
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', role: 'STUDENT', universityId: 'uni1' })
    const tab = socket('good')
    await gateway.handleConnection(tab)

    // Вторая вкладка: userId уже записан, но соединение отвалилось до учёта.
    const late = socket('good')
    late.data.userId = 'u1'
    gateway.handleDisconnect(late)

    expect(gateway.isOnline('u1')).toBe(true)
  })

  it('повторный handleDisconnect того же сокета не списывает соединение дважды', async () => {
    const { gateway, jwt } = setup()
    gateway.setPresenceAudience(jest.fn().mockResolvedValue([]))
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', role: 'STUDENT', universityId: 'uni1' })
    const first = socket('good')
    const second = socket('good')
    await gateway.handleConnection(first)
    await gateway.handleConnection(second)

    gateway.handleDisconnect(first)
    gateway.handleDisconnect(first)

    expect(gateway.isOnline('u1')).toBe(true)
  })
})

describe('RealtimeGateway.getOnlineUserIds', () => {
  it('спрашивает только сокеты адресатов, а не все подключения сервера', async () => {
    const { gateway } = setup()
    const fetchSockets = jest
      .fn()
      .mockResolvedValue([{ data: { userId: 'u1' } }, { data: { userId: 'u1' } }, { data: {} }])
    const server = { in: jest.fn(() => ({ fetchSockets })), fetchSockets: jest.fn() }
    ;(gateway as unknown as { server: Server }).server = server as unknown as Server

    const online = await gateway.getOnlineUserIds(['u1', 'u2', 'u1'])

    expect(online).toEqual(new Set(['u1']))
    expect(server.in).toHaveBeenCalledWith(['user:u1', 'user:u2'])
    expect(server.fetchSockets).not.toHaveBeenCalled()
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

// Токен мини-аппа по HTTP пускает только на @MiniAllowed (MiniAppGuard), а handshake
// guard'ы не проходит: без отказа здесь он открывал бы весь realtime администратора.
describe('RealtimeGateway — токен мини-аппа', () => {
  it('handshake с токеном мини-аппа — разрыв, без комнат и без онлайна', async () => {
    const { gateway, jwt } = setup()
    jwt.verifyAsync.mockResolvedValue({
      sub: 'a1',
      role: 'PLATFORM_ADMIN',
      universityId: null,
      tfa: true,
      client: 'mini',
    })
    const client = socket('mini')
    await gateway.handleConnection(client)
    expect(client.disconnect).toHaveBeenCalled()
    expect(client.join).not.toHaveBeenCalled()
    expect(client.data.userId).toBeUndefined()
    expect(gateway.isOnline('a1')).toBe(false)
  })

  it('отказ не зависит от аварийного выключателя 2FA', async () => {
    const { gateway, jwt } = setup(false)
    jwt.verifyAsync.mockResolvedValue({ sub: 'a1', role: 'PLATFORM_ADMIN', client: 'mini' })
    const client = socket('mini')
    await gateway.handleConnection(client)
    expect(client.disconnect).toHaveBeenCalled()
    expect(client.join).not.toHaveBeenCalled()
  })

  it('auth:refresh токеном мини-аппа рвёт соединение, а не продлевает его', async () => {
    const { gateway, jwt } = setup()
    jwt.verifyAsync.mockResolvedValue({
      sub: 'a1',
      role: 'PLATFORM_ADMIN',
      tfa: true,
      client: 'mini',
    })
    const client = socket()
    client.data.userId = 'prev'
    await gateway.handleAuthRefresh(client, { token: 'mini' })
    expect(client.disconnect).toHaveBeenCalled()
    expect(client.data.userId).toBe('prev')
  })
})

describe('RealtimeGateway — отозванные сессии', () => {
  it('токен, выданный до блокировки, не открывает соединение', async () => {
    const { gateway, jwt, revocation } = setup(false)
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', role: 'STUDENT', iat: 100 })
    revocation.isRevoked.mockResolvedValue(true)
    const client = socket('tok')
    await gateway.handleConnection(client)
    expect(revocation.isRevoked).toHaveBeenCalledWith('u1', 100)
    expect(client.disconnect).toHaveBeenCalled()
    expect(client.join).not.toHaveBeenCalled()
  })
})

// Регрессия: блокировка вуза не закрывала WebSocket. HTTP пользователям закрытого вуза уже
// отвечал UNIVERSITY_BLOCKED, а сокет открывался, продлевался и принимал события чата.
describe('RealtimeGateway — заблокированный вуз', () => {
  const student = { sub: 'u1', role: 'STUDENT', universityId: 'uni1', groupId: 'g1' }

  it('handshake пользователя заблокированного вуза — разрыв, без комнат и без онлайна', async () => {
    const { gateway, jwt, prisma } = setup(false)
    jwt.verifyAsync.mockResolvedValue(student)
    prisma.university.findUnique.mockResolvedValue({ status: 'BLOCKED' })
    const client = socket('tok')
    await gateway.handleConnection(client)
    expect(prisma.university.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'uni1' } }),
    )
    expect(client.disconnect).toHaveBeenCalled()
    expect(client.join).not.toHaveBeenCalled()
    expect(gateway.isOnline('u1')).toBe(false)
  })

  it('платформенную роль статус вуза не касается', async () => {
    const { gateway, jwt, prisma } = setup(false)
    jwt.verifyAsync.mockResolvedValue({ sub: 'p1', role: 'PLATFORM_ADMIN', universityId: 'uni1' })
    prisma.university.findUnique.mockResolvedValue({ status: 'BLOCKED' })
    const client = socket('tok')
    await gateway.handleConnection(client)
    expect(client.disconnect).not.toHaveBeenCalled()
  })

  it('сбой чтения статуса соединение не рвёт — как и HTTP-запрос', async () => {
    const { gateway, jwt, prisma } = setup(false)
    jwt.verifyAsync.mockResolvedValue(student)
    prisma.university.findUnique.mockRejectedValue(new Error('db down'))
    const client = socket('tok')
    await gateway.handleConnection(client)
    expect(client.disconnect).not.toHaveBeenCalled()
    expect(client.join).toHaveBeenCalledWith('user:u1')
  })

  it('auth:refresh после блокировки вуза рвёт соединение, а не продлевает его', async () => {
    const { gateway, jwt, universityAccess } = setup(false)
    jwt.verifyAsync.mockResolvedValue(student)
    const client = socket('tok')
    await gateway.handleConnection(client)
    expect(client.disconnect).not.toHaveBeenCalled()

    universityAccess.remember('uni1', 'BLOCKED')
    await gateway.handleAuthRefresh(client, { token: 'fresh' })
    expect(client.disconnect).toHaveBeenCalled()
  })

  it('disconnectUniversity рвёт сокеты вуза, кроме платформенных ролей', async () => {
    const { gateway, universityAccess } = setup(false)
    universityAccess.remember('uni1', 'BLOCKED')
    const member = {
      data: { userId: 'u1', role: 'STUDENT', universityId: 'uni1' },
      disconnect: jest.fn(),
    }
    const platform = {
      data: { userId: 'p1', role: 'PLATFORM_ADMIN', universityId: 'uni1' },
      disconnect: jest.fn(),
    }
    const fetchSockets = jest.fn().mockResolvedValue([member, platform])
    const server = { in: jest.fn(() => ({ fetchSockets })) }
    ;(gateway as unknown as { server: Server }).server = server as unknown as Server

    await gateway.disconnectUniversity('uni1')

    expect(server.in).toHaveBeenCalledWith('university:uni1')
    expect(member.disconnect).toHaveBeenCalledWith(true)
    expect(platform.disconnect).not.toHaveBeenCalled()
  })

  it('admitSocket: живой сокет заблокированного вуза получает UNIVERSITY_BLOCKED и рвётся', async () => {
    const { gateway, universityAccess } = setup(false)
    const client = socket()
    client.emit = jest.fn() as unknown as Socket['emit']
    Object.assign(client.data, { userId: 'u1', role: 'STUDENT', universityId: 'uni1' })

    await expect(gateway.admitSocket(client, 'message:send')).resolves.toBe(true)
    expect(client.disconnect).not.toHaveBeenCalled()

    universityAccess.remember('uni1', 'BLOCKED')
    await expect(gateway.admitSocket(client, 'message:send')).resolves.toBe(false)
    expect(client.emit).toHaveBeenCalledWith('error', {
      event: 'message:send',
      code: 'UNIVERSITY_BLOCKED',
    })
    expect(client.disconnect).toHaveBeenCalledWith(true)
  })
})
