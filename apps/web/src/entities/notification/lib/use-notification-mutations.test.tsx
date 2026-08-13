import { createElement, type ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { useNotificationMutations } from './use-notification-mutations'
import { notificationKeys } from '../api/notifications-api'
import type { NotificationItem } from '../model/types'

// Мутации бьют по сети — глушим сетевые вызовы, проверяем ОПТИМИСТИЧНЫЙ патч кэша.
vi.mock('../api/notifications-api', async (orig) => {
  const actual = await orig<typeof import('../api/notifications-api')>()
  return {
    ...actual,
    markNotificationRead: vi.fn().mockResolvedValue({}),
    markAllNotificationsRead: vi.fn().mockResolvedValue({ updated: 0 }),
    deleteNotification: vi.fn().mockResolvedValue(undefined),
  }
})

const item = (id: string, isRead: boolean): NotificationItem => ({
  id,
  type: 'SYSTEM',
  title: id,
  body: '',
  data: null,
  isRead,
  readAt: isRead ? new Date().toISOString() : null,
  createdAt: new Date().toISOString(),
})

function setup(list: NotificationItem[], unread: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(notificationKeys.list(), list)
  qc.setQueryData(notificationKeys.unreadCount(), unread)
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => useNotificationMutations(), { wrapper })
  return { qc, result }
}

describe('useNotificationMutations (оптимистичные)', () => {
  it('read: мгновенно помечает прочитанным и уменьшает счётчик', async () => {
    const { qc, result } = setup([item('a', false), item('b', false)], 2)
    result.current.readMutation.mutate('a')
    await waitFor(() => {
      const list = qc.getQueryData<NotificationItem[]>(notificationKeys.list())!
      expect(list.find((n) => n.id === 'a')!.isRead).toBe(true)
      expect(list.find((n) => n.id === 'b')!.isRead).toBe(false)
      expect(qc.getQueryData<number>(notificationKeys.unreadCount())).toBe(1)
    })
  })

  it('read-all: помечает все прочитанными и обнуляет счётчик', async () => {
    const { qc, result } = setup([item('a', false), item('b', false)], 2)
    result.current.readAllMutation.mutate()
    await waitFor(() => {
      const list = qc.getQueryData<NotificationItem[]>(notificationKeys.list())!
      expect(list.every((n) => n.isRead)).toBe(true)
      expect(qc.getQueryData<number>(notificationKeys.unreadCount())).toBe(0)
    })
  })

  it('delete: убирает из списка и уменьшает счётчик для непрочитанного', async () => {
    const { qc, result } = setup([item('a', false), item('b', true)], 1)
    result.current.deleteMutation.mutate('a')
    await waitFor(() => {
      const list = qc.getQueryData<NotificationItem[]>(notificationKeys.list())!
      expect(list.map((n) => n.id)).toEqual(['b'])
      expect(qc.getQueryData<number>(notificationKeys.unreadCount())).toBe(0)
    })
  })
})
