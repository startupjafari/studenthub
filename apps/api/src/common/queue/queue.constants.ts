import type { JobsOptions } from 'bullmq'

// Очереди и job'ы платформы — источник истины docs/PROJECT.md §10.1.
// Имена задаются здесь один раз; процессоры (Ф3.3–3.4, 4.3) и продюсеры ссылаются отсюда.

export const QUEUES = {
  EMAIL: 'email',
  NOTIFICATIONS: 'notifications',
  FILE_PROCESSING: 'file-processing',
  CLEANUP: 'cleanup',
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

// Все зарегистрированные очереди — для BullModule.registerQueue и QueueService.
export const QUEUE_NAMES: QueueName[] = Object.values(QUEUES)

// Имена job'ов по очередям (docs/PROJECT.md §10.1). Процессоры добавятся в следующих задачах.
export const EMAIL_JOBS = {
  SEND_INVITE: 'send-invite',
  SEND_WELCOME: 'send-welcome',
  SEND_APPLICATION_STATUS: 'send-application-status',
  SEND_SCHEDULE_CHANGE: 'send-schedule-change',
  SEND_EVENT_REMINDER: 'send-event-reminder',
  // Обобщённое письмо-зеркало in-app уведомления для офлайн-пользователей (docs/PROJECT.md §10.1).
  SEND_NOTIFICATION: 'send-notification',
} as const

export const NOTIFICATION_JOBS = {
  NEW_MESSAGE: 'new-message',
  SCHEDULE_CHANGED: 'schedule-changed',
  APPLICATION_UPDATED: 'application-updated',
  NEW_POST: 'new-post',
  NEW_STORY: 'new-story',
  EVENT_CREATED: 'event-created',
  EVENT_REMINDER: 'event-reminder',
  COMPLAINT_RESOLVED: 'complaint-resolved',
  DOCUMENT_EXPIRING: 'document-expiring',
  DOCUMENT_REQUEST: 'document-request',
  DOCUMENT_RESULT: 'document-result',
  FRIEND_REQUEST: 'friend-request',
  FRIEND_ACCEPTED: 'friend-accepted',
} as const

export const FILE_JOBS = {
  GENERATE_THUMBNAIL: 'generate-thumbnail',
  COMPRESS_VIDEO: 'compress-video',
  SCAN_FILE: 'scan-file',
} as const

// Базовая конфигурация job'а (docs/BACKEND_RULES.md §9.2, docs/PROJECT.md §10.1):
// 3 попытки, экспоненциальный backoff от 5 с; успешные удаляем, упавшие храним для разбора.
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: true,
  removeOnFail: false,
}
