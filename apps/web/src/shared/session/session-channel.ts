// Межвкладочный канал сессии: выход в одной вкладке гасит её во всех остальных.
//
// Access-токен живёт в памяти каждой вкладки отдельно, и без оповещения соседняя вкладка
// после выхода ещё до 15 минут читала чаты, получала WS-события и наполняла офлайн-кэши SW
// данными того, кто уже вышел. На общем компьютере следующий человек находил их открытыми.

const CHANNEL_NAME = 'studenthub-session'

interface SessionMessage {
  type: 'logout'
}

// Один объект канала на вкладку и для отправки, и для приёма: BroadcastChannel не доставляет
// сообщение самому отправителю, поэтому вкладка, которая выходит, не реагирует на свой же
// выход (её переход на вход уже назначил вызывающий код).
let channel: BroadcastChannel | null | undefined

function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel
  channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME)
  return channel
}

/** Сообщить остальным вкладкам, что в этой вышли. */
export function announceLogout(): void {
  try {
    getChannel()?.postMessage({ type: 'logout' } satisfies SessionMessage)
  } catch {
    // Канал закрыт или недоступен — соседние вкладки погаснут на первом же отказе сервера.
  }
}

/** Подписка на выход в соседней вкладке. Возвращает отписку. */
export function onLogoutElsewhere(handler: () => void): () => void {
  const ch = getChannel()
  if (!ch) return () => undefined
  const listener = (event: MessageEvent<SessionMessage>): void => {
    if (event.data?.type === 'logout') handler()
  }
  ch.addEventListener('message', listener)
  return () => ch.removeEventListener('message', listener)
}
