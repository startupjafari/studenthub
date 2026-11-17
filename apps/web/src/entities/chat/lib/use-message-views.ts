'use client'

import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { chatCountsViews } from '@studenthub/shared-schemas'
import { chatKeys, fetchMessageViews } from '../api/chat-api'

/** Сколько последних сообщений спрашиваем за раз — потолок запроса на сервере. */
const VIEWS_BATCH = 100
/** Как часто освежать счётчики открытого чата: просмотры растут, пока объявление читают. */
const VIEWS_REFRESH_MS = 30_000

const EMPTY = new Map<string, number>()

/**
 * Просмотры сообщений открытого официального чата (Telegram: глаз и число у постов канала).
 *
 * Спрашиваем последние загруженные сообщения одним запросом и освежаем раз в полминуты, пока
 * вкладка на виду. Оптимистичные (`tmp:`) и служебные сообщения не спрашиваем — у первых ещё
 * нет id на сервере, у вторых счётчика не бывает. В чатах без просмотров (личный, группа,
 * поддержка) запроса нет вовсе.
 */
export function useMessageViews(
  chatId: string | null | undefined,
  chatType: string | null | undefined,
  messages: readonly { id: string; systemType?: string | null }[] | undefined,
): Map<string, number> {
  const enabled = !!chatId && !!chatType && chatCountsViews(chatType)
  const ids = useMemo(() => {
    if (!enabled || !messages) return []
    const out: string[] = []
    for (let i = messages.length - 1; i >= 0 && out.length < VIEWS_BATCH; i -= 1) {
      const m = messages[i]
      if (m && !m.id.startsWith('tmp:') && !m.systemType) out.push(m.id)
    }
    return out
  }, [enabled, messages])
  const key = ids.join(',')
  const q = useQuery({
    queryKey: chatKeys.views(chatId ?? '', key),
    queryFn: () => fetchMessageViews(chatId as string, ids),
    enabled: enabled && ids.length > 0,
    // Новое сообщение меняет набор id — пока едет новый ответ, держим прежние числа, а не
    // гасим глаз у всей ленты.
    placeholderData: keepPreviousData,
    refetchInterval: VIEWS_REFRESH_MS,
    staleTime: VIEWS_REFRESH_MS / 2,
  })
  return useMemo(() => (q.data ? new Map(q.data.map((v) => [v.id, v.views])) : EMPTY), [q.data])
}

/** «1,2 тыс.», «15K»: число просмотров компактно, по правилам языка интерфейса. */
export function formatViews(views: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(views)
  } catch {
    return String(views)
  }
}
