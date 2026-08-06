'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useAppSelector } from '../store/hooks'

// Единый socket-провайдер (docs/PROJECT.md §9). В Ф3.7 обслуживает уведомления;
// в Ф9 к тому же соединению добавятся чат-события. Токен берём из Redux (не из localStorage).

const RealtimeContext = createContext<Socket | null>(null)

// Origin WS-сервера = origin API без пути /api/v1 (socket.io слушает на /socket.io того же хоста).
function wsOrigin(): string {
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

  useEffect(() => {
    // Без токена не подключаемся (страница логина и т.п.).
    if (!accessToken) {
      socketRef.current?.disconnect()
      socketRef.current = null
      setSocket(null)
      return
    }

    const instance = io(wsOrigin(), {
      auth: { token: accessToken },
      transports: ['websocket'],
      // Переподключение при обрыве связи; сервер восстановит комнаты в handleConnection.
      reconnection: true,
    })
    socketRef.current = instance
    setSocket(instance)

    return () => {
      instance.disconnect()
      socketRef.current = null
    }
    // Пересоздаём соединение при смене токена (login / silent refresh / logout).
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
