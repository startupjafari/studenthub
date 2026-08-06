// Кросс-приложенческие константы и лимиты (docs/PROJECT.md §8, §7.3–7.4).
// Единый источник для бэкенда (валидация/пагинация) и фронтенда (клиентские проверки).

/** Пагинация (docs/PROJECT.md §8.3). */
export const PAGINATION = {
  DEFAULT_LIMIT: 20,
  /** Максимум для cursor-списков (лента, сообщения). */
  MAX_CURSOR_LIMIT: 50,
  /** Максимум для offset-списков (админ-таблицы). */
  MAX_OFFSET_LIMIT: 100,
} as const

/** Сроки жизни (docs/PROJECT.md §7.3, §3.4). */
export const TTL = {
  INVITE_HOURS: 48,
  STORY_HOURS: 24,
  PRESIGNED_URL_MINUTES: 15,
} as const

/** Rate limiting (docs/PROJECT.md §7.4), запросов за окно. */
export const RATE_LIMIT = {
  LOGIN: { limit: 5, windowSec: 15 * 60 },
  REGISTER_BY_INVITE: { limit: 3, windowSec: 60 * 60 },
  INVITE_PREVIEW: { limit: 10, windowSec: 60 * 60 },
  COMPLAINT: { limit: 10, windowSec: 60 * 60 },
  DEFAULT: { limit: 100, windowSec: 60 },
} as const

/**
 * Файлы (docs/PROJECT.md §5.5, docs/BACKEND_RULES.md §8).
 * Категория определяется по реальному MIME (magic bytes), лимит — по категории.
 * Единый источник для бэкенда (валидация) и фронтенда (клиентская проверка размера/типа).
 */
export const FILE_UPLOAD = {
  /** Максимальный размер по категориям, байты. */
  MAX_BYTES: {
    IMAGE: 10 * 1024 * 1024,
    VIDEO: 100 * 1024 * 1024,
    DOCUMENT: 25 * 1024 * 1024,
    AUDIO: 25 * 1024 * 1024,
  },
  /**
   * Порог буферной загрузки через API-процесс. Файлы больше — только прямой
   * presigned-upload в MinIO (docs/BACKEND_RULES.md §8), иначе память процесса.
   */
  DIRECT_UPLOAD_THRESHOLD_BYTES: 10 * 1024 * 1024,
  /** Белые списки MIME по категориям (значение сверяется с определённым по содержимому). */
  ALLOWED_MIME: {
    IMAGE: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    VIDEO: ['video/mp4', 'video/webm', 'video/quicktime'],
    DOCUMENT: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
    // Голосовые/аудио-вложения чата (Ф9+). webm-контейнер file-type определяет как video/webm.
    AUDIO: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm'],
  },
} as const

export type FileCategory = keyof typeof FILE_UPLOAD.MAX_BYTES

/** Быстрый набор эмодзи-реакций для сообщений чата (Ф9+). Единый для бэка (валидация UI) и фронта. */
export const CHAT_REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🔥', '👀'] as const

/** Окно редактирования сообщения после отправки (Ф9+), мс. Единый источник для бэка и фронта. */
export const MESSAGE_EDIT_WINDOW_MS = 10 * 60 * 1000

export const SUPPORTED_LOCALES = ['ru', 'kk', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'ru'
