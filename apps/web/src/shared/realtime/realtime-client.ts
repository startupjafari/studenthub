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
  const relayConnected = (): void => bus?.post({ kind: 'conn', connected: true, leader: tabId })
  const relayDisconnected = (): void => bus?.post({ kind: 'conn', connected: false, leader: tabId })
  // После переподключения у сервера новый сокет, и о комнатах он не помнит — входим заново во
  // все, что держат вкладки. Раньше повторный join открытого чата глушился рефкаунтом («мы уже
  // в комнате»), и чат после обрыва связи переставал получать сообщения вживую, пока человек
  // не переключится на другой чат. При первом подключении комнат ещё нет — цикл пустой.
  const rejoinRooms = (): void => {
    rooms.forEach((_holders, chatId) => socket.emit(ROOM_JOIN, { chatId }))
  }

  // `onAny` ловит только события сервера — connect/disconnect сокет генерирует сам, их шлём явно.
  socket.onAny(relayAny)
  socket.on('connect', relayConnected)
  socket.on('connect', rejoinRooms)
  socket.on('disconnect', relayDisconnected)

  const unsubscribe = bus?.subscribe((message) => {
    if (message.kind === 'client-emit') {
      execute(message.event, message.args, message.from)
      return
    }
    if (message.kind === 'hello') {
      bus.post({ kind: 'conn', connected: socket.connected, leader: tabId })
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
      // Сокет этой вкладки сейчас закроют, а слушатель disconnect снимается ниже: без явного
      // сообщения ведомые так и считали бы себя на связи.
      relayDisconnected()
      socket.offAny(relayAny)
      socket.off('connect', relayConnected)
      socket.off('connect', rejoinRooms)
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
  // Чей сокет нас обслуживает. Закрытая вкладка-лидер не всегда успевает сказать «связи нет»,
  // и новый лидер начинает с пустой картой комнат: его «на связи» для ведомой, которая и так
  // считала себя на связи, раньше ничего не меняло — не было ни chat:join, ни догона, и
  // открытый чат переставал получать сообщения. Смена лидера — это новое соединение.
  let leader: string | undefined

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
      const newLeader =
        message.leader !== undefined && leader !== undefined && message.leader !== leader
      if (message.leader !== undefined) leader = message.leader
      if (message.connected === connected && !(newLeader && message.connected)) return
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
