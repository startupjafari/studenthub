import type { JobsOptions } from 'bullmq'

// Очереди и job'ы платформы — источник истины docs/PROJECT.md §10.1.
// Имена задаются здесь один раз; процессоры (Ф3.3–3.4, 4.3) и продюсеры ссылаются отсюда.
// Здесь только то, что кто-то ставит в очередь (F-F19): имя job'а без продюсера и
// процессора — это обещание, которое никто не выполняет. Так ушли очередь `cleanup`
// (cron чистит сам, под локом), письма welcome/статус заявки/расписание/напоминание о
// событии, уведомления new-post/new-story/event-created и compress-video/scan-file.

export const QUEUES = {
  EMAIL: 'email',
  NOTIFICATIONS: 'notifications',
  FILE_PROCESSING: 'file-processing',
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

// Имена job'ов по очередям (docs/PROJECT.md §10.1).
export const EMAIL_JOBS = {
  SEND_INVITE: 'send-invite',
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
  // Библиотека (Фаза 20): читателю — выдача, возврат, продление, напоминания о сроке;
  // библиотекарям вуза — «это не я» по выдаче; брони — готова, истекла, отменена.
  LIBRARY_LOAN: 'library-loan',
  LIBRARY_REMINDER: 'library-reminder',
  LIBRARY_RESERVATION: 'library-reservation',
} as const

export const FILE_JOBS = {
  GENERATE_THUMBNAIL: 'generate-thumbnail',
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

const DAY_SECONDS = 24 * 60 * 60

/**
 * Сколько держим упавшие job'ы: неделю и не больше тысячи на очередь (F-F20).
 *
 * Хранить их нужно — по ним мини-апп показывает, что часть работы потеряна, и причину
 * последнего падения. Но не вечно: раньше (`removeOnFail: false`) каждый сбой почты или
 * медиа оставался в Redis навсегда вместе с payload'ом — адресами, именами и ссылками, —
 * и память росла с каждым сбоем. Неделя покрывает выходные: упавшее в пятницу дежурный
 * ещё увидит в понедельник.
 */
const FAILED_RETENTION = { age: 7 * DAY_SECONDS, count: 1000 }

// Базовая конфигурация job'а (docs/BACKEND_RULES.md §9.2, docs/PROJECT.md §10.1):
// 3 попытки, экспоненциальный backoff от 5 с; успешные удаляем, упавшие храним неделю.
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: true,
  removeOnFail: FAILED_RETENTION,
}

/**
 * Почта переживает сбой SMTP дольше остального (F-F20).
 *
 * С базовыми тремя попытками от 5 с job окончательно падал через ~15 секунд: минута
 * недоступности почтового сервера — и все инвайты и сбросы пароля этой минуты не
 * уходили уже никогда. Восемь попыток от 15 с (15, 30, 60 … 960 с) растягивают окно
 * примерно до получаса — перезапуск или короткая авария провайдера его не съедают.
 * Ссылка сброса пароля живёт час, так что и последняя попытка ещё приносит рабочую.
 */
export const EMAIL_JOB_OPTIONS: JobsOptions = {
  ...DEFAULT_JOB_OPTIONS,
  attempts: 8,
  backoff: { type: 'exponential', delay: 15_000 },
}

/**
 * Конфигурация по умолчанию для job'ов очереди. Задаётся при регистрации очереди, поэтому
 * продюсеры её не повторяют; явные опции в `enqueue` (например, `attempts` у видео)
 * по-прежнему сильнее.
 */
export function jobOptionsFor(queue: QueueName): JobsOptions {
  return queue === QUEUES.EMAIL ? EMAIL_JOB_OPTIONS : DEFAULT_JOB_OPTIONS
}
