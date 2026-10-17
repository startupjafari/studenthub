import type { JobsOptions } from 'bullmq'

// Очереди и job'ы платформы — источник истины docs/PROJECT.md §10.1.
// Имена задаются здесь один раз; процессоры (Ф3.3–3.4, 4.3) и продюсеры ссылаются отсюда.

export const QUEUES = {
  EMAIL: 'email',
  NOTIFICATIONS: 'notifications',
  FILE_PROCESSING: 'file-processing',
  CLEANUP: 'cleanup',
  // Асинхронная выборка OG-превью первой ссылки в сообщении (инлайн-превью, Ф9+).
  LINK_PREVIEW: 'link-preview',
  // Единая медиа-система: две очереди, а не одна, — секунда на фото не должна стоять в
  // очереди за получасовым перекодированием видео, и конкурентность у них разная.
  MEDIA_IMAGE: 'media-image',
  MEDIA_VIDEO: 'media-video',
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
  // Карьера (Ф18): подтверждение email при самостоятельной регистрации работодателя.
  // Единственный сценарий на платформе, где адрес не проверен инвайтом заранее.
  SEND_COMPANY_VERIFICATION: 'send-company-verification',
  // Ссылка «забыли пароль» (docs/PROJECT.md §7.2): одноразовая, живёт час.
  SEND_PASSWORD_RESET: 'send-password-reset',
  // Администратор сбросил человеку 2FA (потерян аутентификатор): владелец узнаёт сразу —
  // если сброс просил не он, это сигнал, что учётку пытаются увести.
  SEND_TWO_FACTOR_RESET: 'send-two-factor-reset',
  // Приход вуза (§31): подтверждение адреса заявки и решение по ней. Второй после
  // работодателя случай, когда адрес не проверен инвайтом заранее.
  SEND_DEMO_VERIFICATION: 'send-demo-verification',
  SEND_DEMO_APPROVED: 'send-demo-approved',
  SEND_DEMO_REJECTED: 'send-demo-rejected',
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
  // Предупреждение модерации: промежуточная мера между «нарушения нет» и блокировкой.
  MODERATION_WARNING: 'moderation-warning',
  DOCUMENT_EXPIRING: 'document-expiring',
  DOCUMENT_REQUEST: 'document-request',
  DOCUMENT_RESULT: 'document-result',
  // Владелец открыл документ получателю (грант USER / DEPARTMENT).
  DOCUMENT_SHARED: 'document-shared',
  // Автору запроса документов: студент отправил комплект на проверку.
  DOCUMENT_SUBMITTED: 'document-submitted',
  FRIEND_REQUEST: 'friend-request',
  FRIEND_ACCEPTED: 'friend-accepted',
  // Запрос на переписку (§50): единственное уведомление до принятия — сами сообщения
  // непринятого чата адресата не тревожат.
  CHAT_REQUEST: 'chat-request',
  // Отложенное сообщение не удалось доставить — сообщаем автору, а не теряем молча.
  SCHEDULED_FAILED: 'scheduled-message-failed',
  ASSIGNMENT_PUBLISHED: 'assignment-published',
  ASSIGNMENT_GRADED: 'assignment-graded',
  CONSULTATION_BOOKED: 'consultation-booked',
  CONSULTATION_CANCELLED: 'consultation-cancelled',
  APPOINTMENT_UPDATED: 'appointment-updated',
  // Деканату факультета: студент записался на приём.
  APPOINTMENT_REQUESTED: 'appointment-requested',
  // Студентам группы: экзамен назначен, перенесён (дата/аудитория), внесён результат.
  EXAM_SCHEDULED: 'exam-scheduled',
  EXAM_UPDATED: 'exam-updated',
  EXAM_RESULT: 'exam-result',
  // Автору публикации, статьи или опроса — новый комментарий; упомянутому — упоминание.
  COMMENT_ADDED: 'comment-added',
  COMMENT_MENTION: 'comment-mention',
  // Участникам события: организатор перенёс или отменил событие.
  EVENT_RESCHEDULED: 'event-rescheduled',
  EVENT_CANCELLED: 'event-cancelled',
} as const

export const FILE_JOBS = {
  GENERATE_THUMBNAIL: 'generate-thumbnail',
  COMPRESS_VIDEO: 'compress-video',
  SCAN_FILE: 'scan-file',
} as const

export const MEDIA_JOBS = {
  // Подготовить варианты файла с нуля (изображение — копии и LQIP, видео — постер и HLS).
  PROCESS: 'process-media',
  // Скопировать готовые варианты другого файла (пересылка): перекодировать то же видео
  // второй раз незачем, копия объектов в хранилище — дело секунд.
  COPY: 'copy-media-variants',
} as const

export const LINK_PREVIEW_JOBS = {
  FETCH: 'fetch-link-preview',
} as const

// Базовая конфигурация job'а (docs/BACKEND_RULES.md §9.2, docs/PROJECT.md §10.1):
// 3 попытки, экспоненциальный backoff от 5 с; успешные удаляем, упавшие храним для разбора.
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: true,
  removeOnFail: false,
}
