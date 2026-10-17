'use client'

import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useRealtimeEvent } from '../../../shared/realtime'
import { chatKeys, fetchChatsUnread } from '../api/chat-api'
import { createRefreshCoalescer, type RefreshCoalescer } from './refresh-coalescer'

/** Чужая активность в чатах: бейдж не срочный, поток событий сливаем в один запрос. */
const UNREAD_ACTIVITY_MS = 1500
/** Своё прочтение: бейдж должен погаснуть почти сразу. */
const UNREAD_READ_MS = 200

// Один отложенный перезапрос на клиент запросов: хук смонтирован в нескольких местах
// (сайдбар, шапка), и каждый экземпляр слушает те же события — без общей склейки одно
// событие давало столько же `GET /chats/unread`.
const coalescers = new WeakMap<QueryClient, RefreshCoalescer>()

function unreadCoalescer(qc: QueryClient): RefreshCoalescer {
  let c = coalescers.get(qc)
  if (!c) {
    c = createRefreshCoalescer(() => qc.invalidateQueries({ queryKey: chatKeys.unread() }), {
      minIntervalMs: UNREAD_READ_MS,
    })
    coalescers.set(qc, c)
  }
  return c
}

/**
 * Перезапросить сводку непрочитанного — склеенно со всеми остальными просьбами (F-F02).
 * `soon` — для своего прочтения, иначе — по чужой активности.
 */
export function scheduleChatsUnreadRefresh(qc: QueryClient, soon = false): void {
  unreadCoalescer(qc).soon(soon ? UNREAD_READ_MS : UNREAD_ACTIVITY_MS)
}

/**
 * Число непрочитанных сообщений для бейджа в навигации — без заглушённых чатов: их сервер
 * считает отдельно (`muted`), и в бейдж они не идут, как в Telegram (F-F14).
 *
 * Живёт отдельным лёгким запросом (`GET /chats/unread`), а не выводится из списка чатов:
 * бейдж нужен на каждом экране, а список чатов приходит страницами и с превью — тянуть
 * его ради одного числа дорого.
 *
 * `chat:activity` сервер шлёт каждому участнику на любое движение в чате (в том числе
 * заглушённом), поэтому счётчик обновляется живьём, без опроса по таймеру. Но не на
 * каждое событие: в живой группе они идут потоком, и перезапрос склеивается.
 */
export function useChatsUnread(): number {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: chatKeys.unread(),
    queryFn: fetchChatsUnread,
    // Данные быстро устаревают от чужих сообщений, но и дёргать сервер на каждый
    // ремоунт сайдбара незачем — WS всё равно инвалидирует по факту события.
    staleTime: 30_000,
  })
  useRealtimeEvent('chat:activity', () => {
    scheduleChatsUnreadRefresh(qc)
  })
  // Своё прочтение (на этом или другом устройстве, а также своя отправка — она тоже
  // прочтение): без этого вне раздела чатов бейдж не уменьшался, пока не придёт новое сообщение.
  useRealtimeEvent('chat:read', () => {
    scheduleChatsUnreadRefresh(qc, true)
  })
  return data?.messages ?? 0
}
