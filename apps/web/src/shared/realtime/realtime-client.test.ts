import type { Socket } from 'socket.io-client'
import { describe, expect, it, vi } from 'vitest'
import type { BusMessage, RealtimeBus } from './realtime-bus'
import { createFollowerClient, createLeaderClient } from './realtime-client'

// Шину подменяем вручную: BroadcastChannel здесь не нужен, RealtimeBus — обычный интерфейс.
// Хаб раздаёт «порты»; сообщение из одного порта приходит во все остальные, как в настоящем
// BroadcastChannel (отправителю своё сообщение не возвращается).
function createBusHub() {
  const ports = new Set<{ deliver: (message: BusMessage) => void }>()
  const sent: BusMessage[] = []

  const openPort = (): RealtimeBus => {
    const callbacks = new Set<(message: BusMessage) => void>()
    const port = { deliver: (message: BusMessage) => callbacks.forEach((cb) => cb(message)) }
    ports.add(port)
    return {
      post: (message) => {
        sent.push(message)
        ports.forEach((peer) => {
          if (peer !== port) peer.deliver(message)
        })
      },
      subscribe: (callback) => {
        callbacks.add(callback)
        return () => callbacks.delete(callback)
      },
      close: () => {
        ports.delete(port)
        callbacks.clear()
      },
    }
  }

  return { openPort, sent }
}

function createSocketStub() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const stub = {
    connected: true,
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const set = listeners.get(event) ?? new Set()
      set.add(handler)
      listeners.set(event, set)
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler)
    }),
    onAny: vi.fn(),
    offAny: vi.fn(),
    /** Имитация события, пришедшего с сервера, — через перехваченный onAny. */
    fireAny: (event: string, ...args: unknown[]) => {
      const relay = stub.onAny.mock.calls[0]?.[0] as
        ((event: string, ...args: unknown[]) => void) | undefined
      relay?.(event, ...args)
    },
    fire: (event: string, ...args: unknown[]) => {
      listeners.get(event)?.forEach((handler) => handler(...args))
    },
  }
  return stub
}

describe('createLeaderClient', () => {
  it('ретранслирует события сервера и состояние связи в шину', () => {
    const hub = createBusHub()
    const socket = createSocketStub()
    const leader = createLeaderClient(socket as unknown as Socket, hub.openPort(), 'tab-a')

    socket.fireAny('message:new', { chatId: 'c1' })
    expect(hub.sent).toContainEqual({
      kind: 'server-event',
      event: 'message:new',
      args: [{ chatId: 'c1' }],
    })

    socket.fire('disconnect')
    expect(hub.sent).toContainEqual({ kind: 'conn', connected: false })

    leader.dispose()
  })

  it('исполняет emit ведомой вкладки на своём сокете', () => {
    const hub = createBusHub()
    const socket = createSocketStub()
    const leader = createLeaderClient(socket as unknown as Socket, hub.openPort(), 'tab-a')
    const followerBus = hub.openPort()

    followerBus.post({
      kind: 'client-emit',
      event: 'typing:start',
      args: [{ chatId: 'c1' }],
      from: 'tab-b',
    })

    expect(socket.emit).toHaveBeenCalledWith('typing:start', { chatId: 'c1' })
    leader.dispose()
  })

  it('на hello отвечает текущим состоянием связи', () => {
    const hub = createBusHub()
    const socket = createSocketStub()
    socket.connected = true
    const leader = createLeaderClient(socket as unknown as Socket, hub.openPort(), 'tab-a')

    hub.openPort().post({ kind: 'hello', from: 'tab-b' })

    expect(hub.sent).toContainEqual({ kind: 'conn', connected: true })
    leader.dispose()
  })

  describe('рефкаунт комнат', () => {
    it('в комнату входим один раз, выходим — когда её отпустила последняя вкладка', () => {
      const hub = createBusHub()
      const socket = createSocketStub()
      const leader = createLeaderClient(socket as unknown as Socket, hub.openPort(), 'tab-a')
      const followerBus = hub.openPort()
      const join = { kind: 'client-emit' as const, event: 'chat:join', args: [{ chatId: 'c1' }] }

      leader.emit('chat:join', { chatId: 'c1' })
      followerBus.post({ ...join, from: 'tab-b' })

      // Повторный join второй вкладки серверу не нужен.
      expect(socket.emit).toHaveBeenCalledTimes(1)
      expect(socket.emit).toHaveBeenCalledWith('chat:join', { chatId: 'c1' })

      socket.emit.mockClear()
      // Первая вкладка ушла из чата — вторая всё ещё в нём, из комнаты не выходим.
      leader.emit('chat:leave', { chatId: 'c1' })
      expect(socket.emit).not.toHaveBeenCalled()

      followerBus.post({
        kind: 'client-emit',
        event: 'chat:leave',
        args: [{ chatId: 'c1' }],
        from: 'tab-b',
      })
      expect(socket.emit).toHaveBeenCalledWith('chat:leave', { chatId: 'c1' })

      leader.dispose()
    })

    it('закрытие вкладки освобождает только её комнаты', () => {
      const hub = createBusHub()
      const socket = createSocketStub()
      const leader = createLeaderClient(socket as unknown as Socket, hub.openPort(), 'tab-a')
      const followerBus = hub.openPort()

      leader.emit('chat:join', { chatId: 'c1' })
      followerBus.post({
        kind: 'client-emit',
        event: 'chat:join',
        args: [{ chatId: 'c1' }],
        from: 'tab-b',
      })
      followerBus.post({
        kind: 'client-emit',
        event: 'chat:join',
        args: [{ chatId: 'c2' }],
        from: 'tab-b',
      })
      socket.emit.mockClear()

      followerBus.post({ kind: 'tab-gone', from: 'tab-b' })

      // c1 держит ещё tab-a, c2 не держит никто.
      expect(socket.emit).toHaveBeenCalledExactlyOnceWith('chat:leave', { chatId: 'c2' })
      leader.dispose()
    })
  })
})

describe('createFollowerClient', () => {
  it('доставляет события сервера локальным подписчикам', () => {
    const hub = createBusHub()
    const leaderBus = hub.openPort()
    const follower = createFollowerClient(hub.openPort(), 'tab-b')
    const handler = vi.fn()
    follower.on('message:new', handler)

    leaderBus.post({ kind: 'server-event', event: 'message:new', args: [{ chatId: 'c1' }] })
    expect(handler).toHaveBeenCalledWith({ chatId: 'c1' })

    follower.off('message:new', handler)
    leaderBus.post({ kind: 'server-event', event: 'message:new', args: [{ chatId: 'c2' }] })
    expect(handler).toHaveBeenCalledTimes(1)

    follower.dispose()
  })

  it('синтезирует connect/disconnect из состояния лидера', () => {
    const hub = createBusHub()
    const leaderBus = hub.openPort()
    const follower = createFollowerClient(hub.openPort(), 'tab-b')
    const onConnect = vi.fn()
    const onDisconnect = vi.fn()
    follower.on('connect', onConnect)
    follower.on('disconnect', onDisconnect)

    expect(follower.connected).toBe(false)

    leaderBus.post({ kind: 'conn', connected: true })
    expect(follower.connected).toBe(true)
    expect(onConnect).toHaveBeenCalledTimes(1)

    // Повтор того же состояния лишнего события не порождает.
    leaderBus.post({ kind: 'conn', connected: true })
    expect(onConnect).toHaveBeenCalledTimes(1)

    leaderBus.post({ kind: 'conn', connected: false })
    expect(follower.connected).toBe(false)
    expect(onDisconnect).toHaveBeenCalledTimes(1)

    follower.dispose()
  })

  it('исходящий emit уходит в шину лидеру', () => {
    const hub = createBusHub()
    const follower = createFollowerClient(hub.openPort(), 'tab-b')

    follower.emit('chat:join', { chatId: 'c1' })

    expect(hub.sent).toContainEqual({
      kind: 'client-emit',
      event: 'chat:join',
      args: [{ chatId: 'c1' }],
      from: 'tab-b',
    })
    follower.dispose()
  })
})
