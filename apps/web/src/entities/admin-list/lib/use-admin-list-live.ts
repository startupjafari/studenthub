'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { QueryKey } from '@tanstack/react-query'
import {
  REALTIME_EVENTS,
  type AdminLiveList,
  type RealtimeEnvelope,
} from '@studenthub/shared-schemas'
import { useFreshIds } from '../../../shared/lib'
import { useLiveRefresh } from '../../../shared/realtime'

// Живые админ-списки (`admin.list.changed`, docs/PROJECT.md §9.2d): инвайты, люди вуза,
// жалобы, обращения в поддержку, заявки вузов. Сервер шлёт сигнал без содержимого тем, кто
// ведёт список; экран перечитывает свои запросы, а сервер отдаёт строки по правам зрителя.
//
// Ключи запросов передаёт экран: у каждого списка своя сущность, а слайс сущности не
// импортирует соседние (FSD). Здесь только контракт сигнала и подсветка новых строк.

/**
 * Сколько после сигнала появившиеся строки считаются пришедшими вживую. Без окна подсветка
 * загоралась бы и на смене страницы или фильтра: там тоже появляются «новые» id.
 */
const LIVE_WINDOW_MS = 5_000

const NONE: ReadonlySet<string> = new Set()

/** Какой список изменился — из конверта `admin.list.changed`. */
export function adminListOf(envelope: RealtimeEnvelope): AdminLiveList | null {
  const data = envelope.data as { list?: AdminLiveList } | null
  return data?.list ?? null
}

export interface AdminListLiveOptions {
  /** Слушать ли сейчас (нет прав на раздел, запрос выключен). */
  enabled?: boolean
  /** id строк на экране — чтобы подсветить появившиеся по сигналу (`sh-live-in`). */
  ids?: readonly string[]
}

/**
 * Перечитывать `keys`, когда изменился список `list`. Возвращает id строк, появившихся после
 * сигнала, — им класс `sh-live-in`. Серия сигналов склеивается в один перезапрос
 * (`useLiveRefresh`, 300 мс); фокус вкладки по-прежнему перечитывает данные сам.
 */
export function useAdminListLive(
  list: AdminLiveList,
  keys: QueryKey[],
  options: AdminListLiveOptions = {},
): ReadonlySet<string> {
  const { enabled = true, ids } = options
  const [live, setLive] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLiveRefresh(
    REALTIME_EVENTS.adminListChanged,
    (envelope) => (adminListOf(envelope) === list ? keys : null),
    {
      enabled,
      onSignal: (envelope) => {
        if (adminListOf(envelope) !== list) return
        setLive(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setLive(false), LIVE_WINDOW_MS)
      },
    },
  )

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  // Экраны собирают id заново на каждом рендере. useFreshIds следит за ссылкой на массив, и
  // новая ссылка без новых id сбрасывала бы его таймер снятия подсветки — держим ссылку,
  // пока состав строк тот же.
  const idsKey = ids?.join('|')
  // Зависимость — состав (idsKey), а не ссылка: в этом и смысл мемоизации.
  const stableIds = useMemo(() => ids, [idsKey])
  const fresh = useFreshIds(stableIds)
  return live ? fresh : NONE
}
