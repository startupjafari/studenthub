'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import type { RealtimeEnvelope } from '@studenthub/shared-schemas'
import { useRealtimeEnvelope } from './realtime-context'

// «Сигнал по сокету → перечитать данные» (эпик «всё живое», docs/PROJECT.md §9.2d).
//
// Сервер шлёт сигнал без содержимого — что изменилось и где. Экран сам решает, какие
// запросы от этого устарели, и перечитывает их по своим правам. Серия сигналов (массовое
// действие, разбор очереди) склеивается в один перезапрос за окно `debounceMs`: каждый
// сигнал по отдельности дёргал бы сервер десятками одинаковых запросов.

type Keys = QueryKey[] | ((envelope: RealtimeEnvelope) => QueryKey[] | null)

export interface LiveRefreshOptions {
  /** Окно склейки серии сигналов. */
  debounceMs?: number
  /** Слушать ли сейчас (нет прав на раздел, экран скрыт). */
  enabled?: boolean
  /** Дополнительно к перечитыванию — например, показать «N новых» вместо прыжка ленты. */
  onSignal?: (envelope: RealtimeEnvelope) => void
}

/** Перечитывать `keys`, когда по сокету приходит сигнал типа `type`. */
export function useLiveRefresh(type: string, keys: Keys, options: LiveRefreshOptions = {}): void {
  const { debounceMs = 300, enabled = true, onSignal } = options
  const qc = useQueryClient()
  const keysRef = useRef(keys)
  keysRef.current = keys
  const onSignalRef = useRef(onSignal)
  onSignalRef.current = onSignal
  const pending = useRef<QueryKey[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useRealtimeEnvelope(type, (envelope) => {
    if (!enabled) return
    onSignalRef.current?.(envelope)
    const k = keysRef.current
    const next = typeof k === 'function' ? k(envelope) : k
    if (!next || next.length === 0) return
    pending.current.push(...next)
    if (timer.current) return
    timer.current = setTimeout(() => {
      timer.current = null
      const batch = pending.current
      pending.current = []
      // Одинаковые ключи из серии сигналов — один перезапрос.
      const seen = new Set<string>()
      for (const key of batch) {
        const id = JSON.stringify(key)
        if (seen.has(id)) continue
        seen.add(id)
        void qc.invalidateQueries({ queryKey: key })
      }
    }, debounceMs)
  })

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
}
