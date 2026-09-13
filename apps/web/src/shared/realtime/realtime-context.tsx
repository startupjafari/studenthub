'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useQueryClient } from '@tanstack/react-query'
import { REALTIME_CHANNEL, type RealtimeEnvelope } from '@studenthub/shared-schemas'
import { refreshAccessToken } from '../api/instance'
import { useAppSelector } from '../store/hooks'
import { createLeaderElection } from './leader-election'
import { createRealtimeBus } from './realtime-bus'
import { createFollowerClient, createLeaderClient, type RealtimeClient } from './realtime-client'

// Единый socket-провайдер (docs/PROJECT.md §9). Обслуживает уведомления и чат-события на одном
// соединении. Токен берём из Redux (не из localStorage).
//
// Соединение держит одна вкладка-лидер на аккаунт (leader-election.ts): остальные вкладки
// получают события и отправляют свои emit'ы через неё по BroadcastChannel. Для потребителей
// разницы нет — контекст в обоих случаях отдаёт `RealtimeClient` с тем же API.

const RealtimeContext = createContext<RealtimeClient | null>(null)

// Идентификатор вкладки: лидер по нему считает, сколько вкладок держат комнату чата.
const TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

// Восстановление сессии сокета после разрыва сервером (протухший токен в рукопожатии).
// Не чаще раза в 5 секунд и не больше трёх попыток подряд: если и со свежим токеном
// сервер рвёт связь, дело не в токене, и долбить /auth/refresh нельзя — каждый обмен
// ротирует refresh-cookie, а реюз-детектор гасит всю сессию.
const AUTH_RETRY_MS = 5_000
const AUTH_RETRY_MAX = 3

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
  // Ключ выборов — аккаунт: вкладки разных пользователей не делят соединение.
  const userId = useAppSelector((s) => s.auth.user?.id)
  const queryClient = useQueryClient()
  // Держим клиент в ref: обращаемся к нему из onConnect, не добавляя в deps эффекта (иначе
  // нестабильная ссылка пересоздавала бы сокет). Тот же приём, что и с tokenRef ниже.
  const queryClientRef = useRef(queryClient)
  queryClientRef.current = queryClient
  const [client, setClient] = useState<RealtimeClient | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const isLeaderRef = useRef(false)
  // Актуальный токен для первичного handshake создаваемого сокета (без пересоздания при ротации).
  const tokenRef = useRef(accessToken)
  tokenRef.current = accessToken
  // Реконнект-ресинк: пока связи не было, клиент мог пропустить события (schedule:changed,
  // notification:new, изменения заявок и т.п.) — их никто не переприсылает. На ПОВТОРНОМ connect
  // инвалидируем весь react-query кэш, чтобы все подписанные экраны разом подтянули актуальное
  // состояние. Первый connect вкладки пропускаем (данные только что загружены). Флаг живёт на
  // уровне вкладки, а не сокета: перехват лидерства создаёт новый сокет, но пропуск событий в
  // окне перевыборов реален — ресинк там нужен.
  const hasConnectedOnceRef = useRef(false)

  // Соединение создаём/рвём только по ФАКТУ наличия токена (login ↔ logout), а не на каждую
  // его смену: тихая ротация access-токена каждые ~15 мин иначе роняла бы сокет (мигание
  // presence/typing и лишний реконнект).
  const hasToken = Boolean(accessToken)
  const channelKey = userId ?? 'anon'

  useEffect(() => {
    if (!hasToken) {
      setClient(null)
      return
    }

    const bus = createRealtimeBus(channelKey)
    const election = createLeaderElection(channelKey)
    // Освобождение текущей роли: при смене лидерства старый клиент нужно погасить до создания нового.
    let releaseRole: (() => void) | undefined

    const onConnect = (): void => {
      if (!hasConnectedOnceRef.current) {
        hasConnectedOnceRef.current = true
        return
      }
      void queryClientRef.current.invalidateQueries()
    }

    const applyRole = (isLeader: boolean): void => {
      releaseRole?.()
      releaseRole = undefined
      isLeaderRef.current = isLeader

      // Ведомой вкладке нужна шина; без BroadcastChannel лидером становится каждая вкладка.
      if (!isLeader && bus) {
        const follower = createFollowerClient(bus, TAB_ID)
        follower.on('connect', onConnect)
        setClient(follower)
        releaseRole = () => {
          follower.off('connect', onConnect)
          follower.dispose()
        }
        return
      }

      const socket = io(wsOrigin(), {
        auth: { token: tokenRef.current },
        transports: ['websocket'],
        // Переподключение при обрыве связи; сервер восстановит комнаты в handleConnection.
        reconnection: true,
      })
      socketRef.current = socket
      // Ресинк вешаем до обёртки — она добавит свои служебные слушатели поверх.
      socket.on('connect', onConnect)

      /**
       * Сервер разорвал соединение сам — почти всегда это протухший access-токен в
       * рукопожатии (realtime.gateway: не проверился JWT → `client.disconnect()`).
       *
       * Socket.IO при причине `io server disconnect` НЕ переподключается: считается, что
       * отключил нас сервер и настаивать не надо. Для нас это означало тихо мёртвый
       * сокет до перезагрузки страницы: HTTP продолжал работать (там свой refresh на 401),
       * сообщения уходили в буфер сокета и не долетали никуда, а чат показывал их
       * «отправляется» до таймаута и потом крестиком. Поэтому меняем токен на свежий и
       * переподключаемся руками.
       *
       * Токен протухает и без разрывов — раз в 15 минут; пока сокет жив, его подменяет
       * `auth:refresh` ниже, но у ЗАКРЫТОГО сокета обновлять нечего.
       */
      let authRetries = 0
      let authRetryAt = 0
      const reconnectWithFreshToken = (): void => {
        const now = Date.now()
        if (authRetries >= AUTH_RETRY_MAX || now - authRetryAt < AUTH_RETRY_MS) return
        authRetries += 1
        authRetryAt = now
        void refreshAccessToken()
          .then((token) => {
            socket.auth = { token }
            socket.connect()
          })
          // Обмен не удался — сессия кончилась совсем; выкидывать на /login отсюда не нужно,
          // это сделает ближайший HTTP-запрос через общий перехватчик.
          .catch(() => undefined)
      }
      const onServerDisconnect = (reason: Socket.DisconnectReason): void => {
        if (reason === 'io server disconnect') reconnectWithFreshToken()
      }
      // Связь восстановилась — счётчик попыток обнуляем: следующий разрыв начинает всё заново.
      const onAuthOk = (): void => {
        authRetries = 0
      }
      socket.on('disconnect', onServerDisconnect)
      socket.on('connect', onAuthOk)

      const leader = createLeaderClient(socket, bus, TAB_ID)
      setClient(leader)
      releaseRole = () => {
        socket.off('connect', onConnect)
        socket.off('connect', onAuthOk)
        socket.off('disconnect', onServerDisconnect)
        leader.dispose()
        socket.disconnect()
        socketRef.current = null
      }
    }

    const unsubscribe = election.onChange(applyRole)

    return () => {
      unsubscribe()
      election.destroy()
      releaseRole?.()
      bus?.close()
      setClient(null)
    }
  }, [hasToken, channelKey])

  // Ротация токена: обновляем сессию соединения событием auth:refresh (сервер принимает новый
  // токен без разрыва — realtime.gateway §10). Также правим instance.auth, чтобы возможный
  // реконнект после ротации выполнял handshake уже свежим токеном. Ведомой вкладке делать нечего:
  // сокет аутентифицирован токеном лидера, который ротирует его сам.
  useEffect(() => {
    const instance = socketRef.current
    if (!instance || !accessToken || !isLeaderRef.current) return
    instance.auth = { token: accessToken }
    instance.emit('auth:refresh', { token: accessToken })
  }, [accessToken])

  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>
}

export function useRealtimeSocket(): RealtimeClient | null {
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
    const listener = (...args: unknown[]): void => handlerRef.current(args[0] as T)
    socket.on(event, listener)
    return () => {
      socket.off(event, listener)
    }
  }, [socket, event])
}

// Подписка на единый конверт (docs/PROJECT.md §9, PR-8/#12): слушаем один канал
// REALTIME_CHANNEL и фильтруем по `type` ('domain.entity.action'). Параллельно именованным
// событиям — новые консюмеры используют это, старые продолжают жить на useRealtimeEvent.
export function useRealtimeEnvelope<T = unknown>(
  type: string,
  handler: (envelope: RealtimeEnvelope<T>) => void,
): void {
  const socket = useRealtimeSocket()
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!socket) return
    const listener = (...args: unknown[]): void => {
      const envelope = args[0] as RealtimeEnvelope<T> | undefined
      if (envelope?.type === type) handlerRef.current(envelope)
    }
    socket.on(REALTIME_CHANNEL, listener)
    return () => {
      socket.off(REALTIME_CHANNEL, listener)
    }
  }, [socket, type])
}
