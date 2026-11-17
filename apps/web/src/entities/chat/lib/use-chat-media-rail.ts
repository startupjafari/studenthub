'use client'

import { useCallback, useMemo } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { fetchChatMedia, fetchChatMediaPosition } from '../api/chat-api'
import type { ChatMediaItem } from '../model/types'

/** Сколько кадров до края ленты, чтобы заранее взять следующую страницу. */
const EDGE = 3
/** Лента живёт, пока открыт просмотрщик, и чуть дольше — на повторное открытие того же кадра. */
const RAIL_GC_MS = 60 * 1000

type RailParam = { cursor: string; dir: 'older' | 'newer' }

export interface ChatMediaRail {
  /** Медиа чата по времени (старые — первыми); `null` — лента ещё не приехала. */
  items: ChatMediaItem[] | null
  /** Номер первого элемента `items` среди всех медиа чата (1 — самое старое). */
  first: number
  /** Всего медиа в чате. */
  total: number
  /** Кадр `index` стал текущим — подгрузить соседнюю страницу, если он у края. */
  reach: (index: number) => void
}

/**
 * Все фото и видео чата вокруг открытого кадра — для листания подряд в просмотрщике, как в
 * Telegram, а не только вложений одного сообщения.
 *
 * Опирается на `GET /chats/:id/media` с курсором-кадром в обе стороны (`direction=older` и
 * `newer`) и `…/media/:fileId/position` для «N из M». Сам кадр ни одна из страниц не отдаёт
 * (курсор исключается), его даёт вызывающий — тот, с чего открыли.
 */
export function useChatMediaRail(
  chatId: string | null,
  anchor: ChatMediaItem | null,
): ChatMediaRail {
  const anchorId = anchor?.id ?? null
  const enabled = !!chatId && !!anchorId

  const position = useQuery({
    queryKey: ['chat-media-rail', chatId, anchorId, 'position'],
    queryFn: () => fetchChatMediaPosition(chatId as string, anchorId as string, 'media'),
    enabled,
    staleTime: Infinity,
    gcTime: RAIL_GC_MS,
    retry: false,
  })

  const pages = useInfiniteQuery({
    queryKey: ['chat-media-rail', chatId, anchorId, 'pages'],
    queryFn: ({ pageParam }) =>
      fetchChatMedia(chatId as string, 'media', pageParam.cursor, pageParam.dir),
    // Первая страница — более старые от кадра; более новые приходят «предыдущими» страницами.
    initialPageParam: { cursor: anchorId ?? '', dir: 'older' } as RailParam,
    getNextPageParam: (last): RailParam | undefined =>
      last.hasNext && last.cursor ? { cursor: last.cursor, dir: 'older' } : undefined,
    getPreviousPageParam: (first, _all, firstParam): RailParam | undefined => {
      if (firstParam.dir === 'older')
        return anchorId ? { cursor: anchorId, dir: 'newer' } : undefined
      return first.hasPrev && first.prevCursor
        ? { cursor: first.prevCursor, dir: 'newer' }
        : undefined
    },
    // Параллельно с номером кадра, а не после него: просмотрщик ждёт обоих.
    enabled,
    staleTime: Infinity,
    gcTime: RAIL_GC_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  })

  const data = pages.data
  const pos = position.data
  const rail = useMemo(() => {
    if (!data || !pos || !anchor) return null
    // Страницы — свежие первыми: [новее…] + кадр + [старше…], затем по времени.
    const startAt = data.pageParams.findIndex((p) => (p as RailParam).dir === 'older')
    const newer = data.pages.slice(0, Math.max(0, startAt)).flatMap((p) => p.items)
    const older = data.pages.slice(Math.max(0, startAt)).flatMap((p) => p.items)
    const items = [...newer, anchor, ...older].reverse()
    return { items, first: pos.index - older.length, total: pos.total }
  }, [data, pos, anchor])

  const { hasNextPage, hasPreviousPage, isFetchingNextPage, isFetchingPreviousPage } = pages
  const { fetchNextPage, fetchPreviousPage } = pages
  const length = rail?.items.length ?? 0
  const reach = useCallback(
    (index: number) => {
      if (!length) return
      if (index < EDGE && hasNextPage && !isFetchingNextPage) void fetchNextPage()
      if (index >= length - EDGE && hasPreviousPage && !isFetchingPreviousPage) {
        void fetchPreviousPage()
      }
    },
    [
      length,
      hasNextPage,
      hasPreviousPage,
      isFetchingNextPage,
      isFetchingPreviousPage,
      fetchNextPage,
      fetchPreviousPage,
    ],
  )

  return {
    items: rail?.items ?? null,
    first: rail?.first ?? 1,
    total: rail?.total ?? 0,
    reach,
  }
}
