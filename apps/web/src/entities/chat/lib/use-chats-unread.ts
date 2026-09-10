'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRealtimeEvent } from '../../../shared/realtime'
import { chatKeys, fetchChatsUnread } from '../api/chat-api'

/**
 * Число непрочитанных сообщений для бейджа в навигации.
 *
 * Живёт отдельным лёгким запросом (`GET /chats/unread`), а не выводится из списка чатов:
 * бейдж нужен на каждом экране, а список чатов приходит страницами и с превью — тянуть
 * его ради одного числа дорого.
 *
 * `chat:activity` сервер шлёт каждому участнику на любое движение в чате (в том числе
 * заглушённом), поэтому счётчик обновляется живьём, без опроса по таймеру.
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
    void qc.invalidateQueries({ queryKey: chatKeys.unread() })
  })
  return data?.messages ?? 0
}
