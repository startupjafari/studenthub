import type { NotificationType } from '@prisma/client'
import type { NotificationMessageKey, NotificationParams } from '@studenthub/shared-config'

// Payload job'а очереди `notifications` (docs/PROJECT.md §10.1).
// Продюсеры (Ф6–Ф11) кладут сюда УЖЕ разрешённых получателей. Резолвинг аудитории (кто
// адресат) — ответственность продюсера, не процессора.
//
// ТЕКСТ СОБИРАЕТ ПРОЦЕССОР, А НЕ ПРОДЮСЕР. До появления языка у пользователя продюсер клал
// готовую русскую строку — и это единственное, что он мог сделать: у него на руках один
// job на всех получателей, а язык у каждого свой. Поэтому продюсер кладёт ключ словарной
// статьи и параметры, а строку собирает процессор — там, где он и так читает получателя
// из базы вместе с его `locale`.
export interface NotificationJobData {
  // Кому доставить (id пользователей).
  recipientIds: string[]
  type: NotificationType

  // Ключ словарной статьи (shared-config) и подстановки к ней.
  titleKey?: NotificationMessageKey
  bodyKey?: NotificationMessageKey
  params?: NotificationParams

  // Готовый текст — для того, чему словарной статьи не бывает: имя отправителя в заголовке
  // уведомления о сообщении, превью самого сообщения, комментарий сотрудника. Переводить
  // пользовательский ввод нечем.
  //
  // Он же — запас на время выкатки: job'ы, положенные в очередь предыдущей версией кода,
  // приходят без ключей, и процессор обязан их доставить, а не уронить.
  title?: string
  body?: string

  // Идентификаторы для перехода в клиенте (chatId, postId, applicationId, eventId, url…).
  data?: Record<string, unknown> | null
  // Стабильный ключ источника для идемпотентности, например `new-message:{messageId}`.
  // Уникален в пределах пользователя (Notification.@@unique([userId, dedupeKey])).
  dedupeKey: string
  // Слать ли офлайн-получателям письмо-зеркало (по умолчанию true).
  emailFallback?: boolean
}
