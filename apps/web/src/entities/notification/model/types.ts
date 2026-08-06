// Типы уведомлений — зеркало ответа API (docs/PROJECT.md §10.1).
export type NotificationType =
  'SCHEDULE_CHANGE' | 'APP_UPDATE' | 'MESSAGE' | 'POST' | 'EVENT' | 'SYSTEM'

export interface NotificationItem {
  id: string
  type: NotificationType
  title: string
  body: string
  data: Record<string, unknown> | null
  isRead: boolean
  readAt: string | null
  createdAt: string
}

export interface NotificationSettingsData {
  emailEnabled: boolean
  pushEnabled: boolean
  scheduleChangeEnabled: boolean
  appUpdateEnabled: boolean
  messageEnabled: boolean
  postEnabled: boolean
  eventEnabled: boolean
  systemEnabled: boolean
}

// Ключи пер-тип настроек — для рендера переключателей списком.
export const NOTIFICATION_TYPE_SETTINGS: (keyof NotificationSettingsData)[] = [
  'scheduleChangeEnabled',
  'appUpdateEnabled',
  'messageEnabled',
  'postEnabled',
  'eventEnabled',
  'systemEnabled',
]
