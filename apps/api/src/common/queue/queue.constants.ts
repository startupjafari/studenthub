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
  // Служебные сообщения в Telegram (docs/TELEGRAM_BOT.md §4.3). Очередь регистрируется
  // всегда (это только продюсер), а воркер — лишь когда задан TELEGRAM_BOT_TOKEN.
  OPS_NOTIFY: 'ops-notify',
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
  ASSIGNMENT_PUBLISHED: 'assignment-published',
  ASSIGNMENT_GRADED: 'assignment-graded',
  CONSULTATION_BOOKED: 'consultation-booked',
  CONSULTATION_CANCELLED: 'consultation-cancelled',
  APPOINTMENT_UPDATED: 'appointment-updated',
} as const

export const FILE_JOBS = {
  GENERATE_THUMBNAIL: 'generate-thumbnail',
  COMPRESS_VIDEO: 'compress-video',
  SCAN_FILE: 'scan-file',
} as const

export const LINK_PREVIEW_JOBS = {
  FETCH: 'fetch-link-preview',
} as const

// Служебный канал (docs/TELEGRAM_BOT.md). SEND — доставка готового сообщения;
// QUIET_ENDED — отложенный job, который по истечении тишины шлёт сводку (§3.5).
export const OPS_JOBS = {
  SEND: 'ops-send',
  // Событие, приехавшее из вебхука: контроллер отвечает сразу, обработка — здесь (§5).
  EMIT: 'ops-emit',
  // Команда из чата (§6): контроллер отвечает Telegram сразу, ответ собирается здесь.
  COMMAND: 'ops-command',
  QUIET_ENDED: 'ops-quiet-ended',
  // Проверки по расписанию (docs/TELEGRAM_BOT.md §7.3.4): repeatable job'ы вместо @Cron —
  // расписание лежит в общем Redis, поэтому проверка идёт на одной реплике, а не на каждой.
  CHECK_CRON_SILENCE: 'ops-check-cron-silence',
  CHECK_QUEUES: 'ops-check-queues',
  CHECK_DEPENDENCIES: 'ops-check-dependencies',
  CHECK_PUBLIC_PING: 'ops-check-public-ping',
  CHECK_PINNED_STATUS: 'ops-check-pinned-status',
  CHECK_SECURITY: 'ops-check-security',
  CHECK_DIGEST: 'ops-check-digest',
  CHECK_BRANCH_DRIFT: 'ops-check-branch-drift',
} as const

// Базовая конфигурация job'а (docs/BACKEND_RULES.md §9.2, docs/PROJECT.md §10.1):
// 3 попытки, экспоненциальный backoff от 5 с; успешные удаляем, упавшие храним для разбора.
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: true,
  removeOnFail: false,
}
