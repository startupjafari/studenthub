// Типы уведомлений — зеркало ответа API (docs/PROJECT.md §10.1).
export type NotificationType =
  'SCHEDULE_CHANGE' | 'APP_UPDATE' | 'MESSAGE' | 'POST' | 'EVENT' | 'SYSTEM'

export interface NotificationItem {
  id: string
  type: NotificationType
  // Текст, отрисованный на языке получателя в момент создания уведомления.
  title: string
  body: string
  // Ключ словарной статьи и подстановки к ней (shared-config). Есть — собираем строку
  // заново на текущем языке, нет — показываем title/body как есть. Пусто у уведомлений
  // без словарной статьи (имя отправителя, превью сообщения) и у созданных до i18n.
  titleKey: string | null
  bodyKey: string | null
  params: Record<string, string | number> | null
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
