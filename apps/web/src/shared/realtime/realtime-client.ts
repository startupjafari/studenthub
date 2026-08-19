import type { Socket } from 'socket.io-client'
import type { RealtimeBus } from './realtime-bus'

// Клиент realtime для потребителей. Повторяет ту часть API socket.io, которой пользуется
// приложение (проверено: вне провайдера сокет берут только в widgets/chat-window). Лидер отдаёт
// обёртку над настоящим сокетом, ведомая вкладка — прокси поверх шины.

export type RealtimeHandler = (...args: unknown[]) => void

export interface RealtimeClient {
  on: (event: string, handler: RealtimeHandler) => void
  off: (event: string, handler: RealtimeHandler) => void
  emit: (event: string, ...args: unknown[]) => void
  readonly connected: boolean
}

export interface DisposableRealtimeClient extends RealtimeClient {
  dispose: () => void
}

// Комнату чата держит несколько вкладок сразу: сокет один, а `chat:leave` от одной вкладки не
// должен выкидывать из комнаты остальные. Отсюда рефкаунт по chatId.
const ROOM_JOIN = 'chat:join'
const ROOM_LEAVE = 'chat:leave'

function chatIdOf(args: unknown[]): string | null {
  const [payload] = args
  if (!payload || typeof payload !== 'object') return null
  const { chatId } = payload as { chatId?: unknown }
  return typeof chatId === 'string' && chatId.length > 0 ? chatId : null
}

/**
 * Вкладка-лидер: держит сокет, ретранслирует входящие события в шину и исполняет emit'ы
 * ведомых вкладок. `on`/`off` уходят прямо в сокет — лишний слой здесь не нужен.
 */
export function createLeaderClient(
  socket: Socket,
  bus: RealtimeBus | null,
  tabId: string,
): DisposableRealtimeClient {
  const rooms = new Map<string, Set<string>>()

  // Единая точка исполнения emit'ов — и своих, и пришедших от ведомых вкладок.
  const execute = (event: string, args: unknown[], from: string): void => {
    if (event === ROOM_JOIN) {
      const chatId = chatIdOf(args)
      if (!chatId) return
      const holders = rooms.get(chatId) ?? new Set<string>()
      const wasEmpty = holders.size === 0
      holders.add(from)
      rooms.set(chatId, holders)
      // В комнату входим один раз — повторный join от другой вкладки серверу не нужен.
      if (wasEmpty) socket.emit(event, ...args)
      return
    }

    if (event === ROOM_LEAVE) {
      const chatId = chatIdOf(args)
      if (!chatId) return
      const holders = rooms.get(chatId)
      if (!holders) return
      holders.delete(from)
      if (holders.size > 0) return
      rooms.delete(chatId)
      socket.emit(event, ...args)
      return
    }

    socket.emit(event, ...args)
  }

  // Вкладка закрылась — отпускаем комнаты, которые держала только она.
  const releaseTab = (from: string): void => {
    rooms.forEach((holders, chatId) => {
      if (!holders.delete(from) || holders.size > 0) return
      rooms.delete(chatId)
      socket.emit(ROOM_LEAVE, { chatId })
    })
  }

  const relayAny = (event: string, ...args: unknown[]): void => {
    bus?.post({ kind: 'server-event', event, args })
  }
  const relayConnected = (): void => bus?.post({ kind: 'conn', connected: true })
  const relayDisconnected = (): void => bus?.post({ kind: 'conn', connected: false })

  // `onAny` ловит только события сервера — connect/disconnect сокет генерирует сам, их шлём явно.
  socket.onAny(relayAny)
  socket.on('connect', relayConnected)
  socket.on('disconnect', relayDisconnected)

  const unsubscribe = bus?.subscribe((message) => {
    if (message.kind === 'client-emit') {
      execute(message.event, message.args, message.from)
      return
    }
    if (message.kind === 'hello') {
      bus.post({ kind: 'conn', connected: socket.connected })
      return
    }
    if (message.kind === 'tab-gone') releaseTab(message.from)
  })

  return {
    on: (event, handler) => {
      socket.on(event, handler)
    },
    off: (event, handler) => {
      socket.off(event, handler)
    },
    emit: (event, ...args) => execute(event, args, tabId),
    get connected() {
      return socket.connected
    },
    dispose: () => {
      unsubscribe?.()
      socket.offAny(relayAny)
      socket.off('connect', relayConnected)
      socket.off('disconnect', relayDisconnected)
      rooms.clear()
    },
  }
}

/**
 * Ведомая вкладка: своего сокета нет. Подписки живут в локальном эмиттере, который наполняется
 * из шины; исходящие emit'ы уходят лидеру. `connect`/`disconnect` синтезируются из сообщений
 * `conn`, поэтому потребители (индикатор связи, ре-join комнаты) работают без изменений.
 */
export function createFollowerClient(bus: RealtimeBus, tabId: string): DisposableRealtimeClient {
  const handlers = new Map<string, Set<RealtimeHandler>>()
  let connected = false

  const dispatch = (event: string, args: unknown[]): void => {
    // Копия набора: обработчик может отписаться прямо во время вызова.
    handlers.get(event)?.forEach((handler) => handler(...args))
  }

  const unsubscribe = bus.subscribe((message) => {
    if (message.kind === 'server-event') {
      dispatch(message.event, message.args)
      return
    }
    if (message.kind === 'conn') {
      if (message.connected === connected) return
      connected = message.connected
      dispatch(connected ? 'connect' : 'disconnect', [])
    }
  })

  const onPageHide = (): void => bus.post({ kind: 'tab-gone', from: tabId })
  window.addEventListener('pagehide', onPageHide)

  // Узнаём текущее состояние связи у лидера.
  bus.post({ kind: 'hello', from: tabId })

  return {
    on: (event, handler) => {
      const set = handlers.get(event) ?? new Set<RealtimeHandler>()
      set.add(handler)
      handlers.set(event, set)
    },
    off: (event, handler) => {
      const set = handlers.get(event)
      if (!set) return
      set.delete(handler)
      if (set.size === 0) handlers.delete(event)
    },
    emit: (event, ...args) => bus.post({ kind: 'client-emit', event, args, from: tabId }),
    get connected() {
      return connected
    },
    dispose: () => {
      unsubscribe()
      window.removeEventListener('pagehide', onPageHide)
      // Комнаты этой вкладки должен отпустить лидер — она больше не участвует в рефкаунте.
      bus.post({ kind: 'tab-gone', from: tabId })
      handlers.clear()
    },
  }
}
