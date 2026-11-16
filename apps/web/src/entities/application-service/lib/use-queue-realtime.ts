'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { useRealtimeEnvelope } from '../../../shared/realtime'
import { applicationKeys } from '../api/application-service-api'

// Серия событий (разбор очереди, массовое назначение) склеивается в один перезапрос.
const QUEUE_REFRESH_MS = 300

/**
 * Живая очередь заявок декана, админа и модератора вуза (21.B3, docs/PROJECT.md §9.2a).
 *
 * Сервер шлёт `application.queue.changed` тем, чья очередь показывает заявку, когда её
 * подают, отзывают, переводят по статусам или поручают ответственному. Payload — только
 * статус, поэтому список, счётчики и открытая карточка перезапрашиваются, а не правятся
 * по событию: фильтр, сортировка и страница у каждого экрана свои.
 */
export function useApplicationQueueRealtime(): void {
  const qc = useQueryClient()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const changed = useRef(new Set<string>())

  useRealtimeEnvelope(REALTIME_EVENTS.applicationQueueChanged, (envelope) => {
    changed.current.add(envelope.entityId)
    if (timer.current) return
    timer.current = setTimeout(() => {
      timer.current = null
      const ids = [...changed.current]
      changed.current.clear()
      void qc.invalidateQueries({ queryKey: [...applicationKeys.all, 'list'] })
      void qc.invalidateQueries({ queryKey: [...applicationKeys.all, 'queue-stats'] })
      for (const id of ids) void qc.invalidateQueries({ queryKey: applicationKeys.detail(id) })
    }, QUEUE_REFRESH_MS)
  })

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
}
