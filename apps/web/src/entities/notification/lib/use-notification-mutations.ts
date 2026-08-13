import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  notificationKeys,
} from '../api/notifications-api'
import type { NotificationItem } from '../model/types'

// Оптимистичные мутации уведомлений (FRONTEND_RULES §5.5): UI меняется мгновенно (прочитано/
// удалено), сеть идёт в фоне, при ошибке — откат снимка. Один источник для колокольчика и
// полноэкранного списка (убирает дублирование await→invalidate).
interface Snapshot {
  list: NotificationItem[] | undefined
  unread: number | undefined
}

export function useNotificationMutations() {
  const qc = useQueryClient()

  const patchList = (fn: (items: NotificationItem[]) => NotificationItem[]): void => {
    qc.setQueryData<NotificationItem[]>(notificationKeys.list(), (old) => (old ? fn(old) : old))
  }
  const setUnread = (fn: (n: number) => number): void => {
    qc.setQueryData<number>(notificationKeys.unreadCount(), (old) => Math.max(0, fn(old ?? 0)))
  }
  const snapshot = (): Snapshot => ({
    list: qc.getQueryData<NotificationItem[]>(notificationKeys.list()),
    unread: qc.getQueryData<number>(notificationKeys.unreadCount()),
  })
  const restore = (snap: Snapshot): void => {
    qc.setQueryData(notificationKeys.list(), snap.list)
    qc.setQueryData(notificationKeys.unreadCount(), snap.unread)
  }
  // Перед оптимистичным патчем гасим фоновые рефетчи, иначе их ответ затрёт наш снимок.
  const cancel = async (): Promise<void> => {
    await Promise.all([
      qc.cancelQueries({ queryKey: notificationKeys.list() }),
      qc.cancelQueries({ queryKey: notificationKeys.unreadCount() }),
    ])
  }
  const settle = (): void => {
    void qc.invalidateQueries({ queryKey: notificationKeys.unreadCount() })
    void qc.invalidateQueries({ queryKey: notificationKeys.list() })
  }

  const readMutation = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onMutate: async (id): Promise<Snapshot> => {
      await cancel()
      const snap = snapshot()
      const wasUnread = snap.list?.some((n) => n.id === id && !n.isRead)
      patchList((items) =>
        items.map((n) =>
          n.id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n,
        ),
      )
      if (wasUnread) setUnread((n) => n - 1)
      return snap
    },
    onError: (_e, _id, snap) => snap && restore(snap),
    onSettled: settle,
  })

  const readAllMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onMutate: async (): Promise<Snapshot> => {
      await cancel()
      const snap = snapshot()
      const now = new Date().toISOString()
      patchList((items) => items.map((n) => (n.isRead ? n : { ...n, isRead: true, readAt: now })))
      setUnread(() => 0)
      return snap
    },
    onError: (_e, _v, snap) => snap && restore(snap),
    onSettled: settle,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNotification(id),
    onMutate: async (id): Promise<Snapshot> => {
      await cancel()
      const snap = snapshot()
      const wasUnread = snap.list?.some((n) => n.id === id && !n.isRead)
      patchList((items) => items.filter((n) => n.id !== id))
      if (wasUnread) setUnread((n) => n - 1)
      return snap
    },
    onError: (_e, _id, snap) => snap && restore(snap),
    onSettled: settle,
  })

  return { readMutation, readAllMutation, deleteMutation }
}
