import type { NotificationType } from '@prisma/client'

// Payload job'а очереди `notifications` (docs/PROJECT.md §10.1).
// Продюсеры (Ф6–Ф11) кладут сюда УЖЕ разрешённых получателей и готовые title/body.
// Резолвинг аудитории (кто адресат) — ответственность продюсера, не процессора.
export interface NotificationJobData {
  // Кому доставить (id пользователей).
  recipientIds: string[]
  type: NotificationType
  title: string
  body: string
  // Идентификаторы для перехода в клиенте (chatId, postId, applicationId, eventId, url…).
  data?: Record<string, unknown> | null
  // Стабильный ключ источника для идемпотентности, например `new-message:{messageId}`.
  // Уникален в пределах пользователя (Notification.@@unique([userId, dedupeKey])).
  dedupeKey: string
  // Слать ли офлайн-получателям письмо-зеркало (по умолчанию true).
  emailFallback?: boolean
}
