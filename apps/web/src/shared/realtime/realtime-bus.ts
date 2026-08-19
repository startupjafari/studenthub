// Шина между вкладками одного аккаунта. Лидер (leader-election.ts) держит сокет и ретранслирует
// сюда события сервера; ведомые вкладки отправляют сюда свои emit'ы. Канал отделён от канала
// выборов, чтобы служебный трафик не мешался с данными.

export type BusMessage =
  // Лидер → всем: событие, пришедшее с сервера.
  | { kind: 'server-event'; event: string; args: unknown[] }
  // Ведомая → лидеру: исходящий emit, который нужно отправить в сокет.
  | { kind: 'client-emit'; event: string; args: unknown[]; from: string }
  // Лидер → всем: состояние соединения (ведомые не имеют своего сокета).
  | { kind: 'conn'; connected: boolean }
  // Новая ведомая вкладка просит лидера прислать текущее состояние соединения.
  | { kind: 'hello'; from: string }
  // Вкладка закрывается: лидер освобождает комнаты, которые держала только она.
  | { kind: 'tab-gone'; from: string }

export interface RealtimeBus {
  post: (message: BusMessage) => void
  subscribe: (callback: (message: BusMessage) => void) => () => void
  close: () => void
}

/** `null` — BroadcastChannel недоступен; вызывающий код работает в одиночном режиме. */
export function createRealtimeBus(key: string): RealtimeBus | null {
  if (typeof BroadcastChannel === 'undefined') return null

  const channel = new BroadcastChannel(`studenthub-realtime:${key}`)
  const callbacks = new Set<(message: BusMessage) => void>()
  let closed = false

  channel.onmessage = ({ data }: MessageEvent<BusMessage>) => {
    if (closed || !data) return
    callbacks.forEach((cb) => cb(data))
  }

  return {
    post: (message) => {
      if (!closed) channel.postMessage(message)
    },
    subscribe: (callback) => {
      callbacks.add(callback)
      return () => callbacks.delete(callback)
    },
    close: () => {
      if (closed) return
      closed = true
      callbacks.clear()
      channel.onmessage = null
      channel.close()
    },
  }
}
