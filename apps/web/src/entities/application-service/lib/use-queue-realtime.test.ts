import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invalidateMock, subscriptions } = vi.hoisted(() => ({
  invalidateMock: vi.fn(),
  subscriptions: new Map<string, (envelope: { entityId: string }) => void>(),
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: invalidateMock }),
}))
vi.mock('../../../shared/realtime', () => ({
  useRealtimeEnvelope: (type: string, handler: (envelope: { entityId: string }) => void) => {
    subscriptions.set(type, handler)
  },
}))
// Сетевой слой сущности тянет axios-инстанс и стор — ключам запросов он не нужен.
vi.mock('../../../shared/api', () => ({ api: {} }))

import { useApplicationQueueRealtime } from './use-queue-realtime'

const emit = (entityId: string): void => {
  subscriptions.get('application.queue.changed')?.({ entityId })
}
const keys = (): unknown[] => invalidateMock.mock.calls.map((call) => call[0].queryKey)

beforeEach(() => {
  vi.useFakeTimers()
  invalidateMock.mockClear()
  subscriptions.clear()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useApplicationQueueRealtime', () => {
  it('подписан на application.queue.changed', () => {
    renderHook(() => useApplicationQueueRealtime())
    expect(subscriptions.has('application.queue.changed')).toBe(true)
  })

  it('перезапрашивает список, счётчики и карточку изменённой заявки', () => {
    renderHook(() => useApplicationQueueRealtime())
    emit('a1')
    vi.runAllTimers()
    expect(keys()).toEqual([
      ['applications-v2', 'list'],
      ['applications-v2', 'queue-stats'],
      ['applications-v2', 'detail', 'a1'],
    ])
  })

  it('серию событий склеивает в один перезапрос списка', () => {
    renderHook(() => useApplicationQueueRealtime())
    emit('a1')
    emit('a2')
    emit('a1')
    vi.runAllTimers()
    const lists = keys().filter((k) => (k as string[])[1] === 'list')
    expect(lists).toHaveLength(1)
    expect(keys()).toContainEqual(['applications-v2', 'detail', 'a1'])
    expect(keys()).toContainEqual(['applications-v2', 'detail', 'a2'])
  })

  it('после размонтирования ничего не перезапрашивает', () => {
    const { unmount } = renderHook(() => useApplicationQueueRealtime())
    emit('a1')
    unmount()
    vi.runAllTimers()
    expect(invalidateMock).not.toHaveBeenCalled()
  })
})
