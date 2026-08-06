import { api } from '../../../shared/api'
import type { NotificationItem, NotificationSettingsData } from '../model/types'

// Фабрика ключей React Query (docs/FRONTEND_RULES.md §5.2).
export const notificationKeys = {
  all: ['notifications'] as const,
  list: () => [...notificationKeys.all, 'list'] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
  settings: () => [...notificationKeys.all, 'settings'] as const,
}

// Список последних уведомлений (для колокола). axios-интерцептор разворачивает конверт и
// теряет meta.cursor — для колокола достаточно последних N без «загрузить ещё» (§ ограничение).
export async function fetchNotifications(limit = 20): Promise<NotificationItem[]> {
  const { data } = await api.get<NotificationItem[]>('/notifications', { params: { limit } })
  return data
}

export async function fetchUnreadCount(): Promise<number> {
  const { data } = await api.get<{ count: number }>('/notifications/unread-count')
  return data.count
}

export async function markNotificationRead(id: string): Promise<NotificationItem> {
  const { data } = await api.patch<NotificationItem>(`/notifications/${id}/read`)
  return data
}

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  const { data } = await api.patch<{ updated: number }>('/notifications/read-all')
  return data
}

export async function deleteNotification(id: string): Promise<void> {
  await api.delete(`/notifications/${id}`)
}

export async function fetchNotificationSettings(): Promise<NotificationSettingsData> {
  const { data } = await api.get<NotificationSettingsData>('/notifications/settings')
  return data
}

export async function updateNotificationSettings(
  patch: Partial<NotificationSettingsData>,
): Promise<NotificationSettingsData> {
  const { data } = await api.patch<NotificationSettingsData>('/notifications/settings', patch)
  return data
}
