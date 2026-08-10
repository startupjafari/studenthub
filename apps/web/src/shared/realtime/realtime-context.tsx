'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useAppSelector } from '../store/hooks'

// Единый socket-провайдер (docs/PROJECT.md §9). В Ф3.7 обслуживает уведомления;
// в Ф9 к тому же соединению добавятся чат-события. Токен берём из Redux (не из localStorage).

const RealtimeContext = createContext<Socket | null>(null)

// Origin WS-сервера. Сокет всегда идёт ПРЯМО на api (авторизация токеном, не cookie),
// даже когда HTTP проксируется через web (единый origin) — поэтому берём отдельный
// NEXT_PUBLIC_WS_URL. Фолбэк — вывести origin из NEXT_PUBLIC_API_URL (актуально в dev,
// где он абсолютный: http://localhost:3001/api/v1).
function wsOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_WS_URL
  if (explicit) {
    try {
      return new URL(explicit).origin
    } catch {
      /* игнорируем битый WS_URL, пробуем API_URL ниже */
    }
  }
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'
  try {
    return new URL(apiUrl).origin
  } catch {
    return 'http://localhost:3001'
  }
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const accessToken = useAppSelector((s) => s.auth.accessToken)
  const [socket, setSocket] = useState<Socket | null>(null)
  const socketRef = useRef<Socket | null>(null)
  // Актуальный токен для первичного handshake создаваемого сокета (без пересоздания при ротации).
  const tokenRef = useRef(accessToken)
  tokenRef.current = accessToken

  // Соединение создаём/рвём только по ФАКТУ наличия токена (login ↔ logout), а не на каждую
  // его смену: тихая ротация access-токена каждые ~15 мин иначе роняла бы сокет (мигание
  // presence/typing и лишний реконнект).
  const hasToken = Boolean(accessToken)
  useEffect(() => {
    if (!hasToken) {
      socketRef.current?.disconnect()
      socketRef.current = null
      setSocket(null)
      return
    }

    const instance = io(wsOrigin(), {
      auth: { token: tokenRef.current },
      transports: ['websocket'],
      // Переподключение при обрыве связи; сервер восстановит комнаты в handleConnection.
      reconnection: true,
    })
    socketRef.current = instance
    setSocket(instance)

    return () => {
      instance.disconnect()
      socketRef.current = null
      setSocket(null)
    }
  }, [hasToken])

  // Ротация токена: обновляем сессию соединения событием auth:refresh (сервер принимает новый
  // токен без разрыва — realtime.gateway §10). Также правим instance.auth, чтобы возможный
  // реконнект после ротации выполнял handshake уже свежим токеном.
  useEffect(() => {
    const instance = socketRef.current
    if (!instance || !accessToken) return
    instance.auth = { token: accessToken }
    instance.emit('auth:refresh', { token: accessToken })
  }, [accessToken])

  return <RealtimeContext.Provider value={socket}>{children}</RealtimeContext.Provider>
}

export function useRealtimeSocket(): Socket | null {
  return useContext(RealtimeContext)
}

// Подписка на серверное событие с автоотпиской. handler держим в ref, чтобы не переподписываться
// на каждый рендер из-за нестабильной ссылки на колбэк.
export function useRealtimeEvent<T = unknown>(event: string, handler: (payload: T) => void): void {
  const socket = useRealtimeSocket()
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!socket) return
    const listener = (payload: T): void => handlerRef.current(payload)
    socket.on(event, listener)
    return () => {
      socket.off(event, listener)
    }
  }, [socket, event])
}
