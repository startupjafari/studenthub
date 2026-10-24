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
    // Видео и документы — категории, где прежние 100 и 25 МБ упирались в реальные файлы:
    // лекция с телефона и скан сборника весят больше. Такие грузятся только частями
    // (см. MULTIPART_* ниже), через API-процесс они не идут.
    VIDEO: 500 * 1024 * 1024,
    DOCUMENT: 500 * 1024 * 1024,
    AUDIO: 25 * 1024 * 1024,
    // Архив во вложении чата: проект, выгрузка, набор сканов одним файлом — весит как
    // документ, поэтому и предел тот же.
    ARCHIVE: 500 * 1024 * 1024,
  },
  /**
   * Порог буферной загрузки через API-процесс. Файлы больше — только прямой
   * presigned-upload в MinIO (docs/BACKEND_RULES.md §8), иначе память процесса.
   */
  DIRECT_UPLOAD_THRESHOLD_BYTES: 10 * 1024 * 1024,
  /**
   * Порог многочастной загрузки. Выше него файл режется на части и заливается по подписанной
   * ссылке на каждую: одним PUT полутрагигабайтный ролик по мобильной сети доезжает редко, а
   * обрыв на 80 % означает заливку заново.
   *
   * 50 МБ, а не сразу после буферного порога: между 10 и 50 МБ одиночный PUT ещё надёжен,
   * а многочастная схема стоит трёх лишних запросов и состояния для докачки.
   */
  MULTIPART_THRESHOLD_BYTES: 50 * 1024 * 1024,
  /**
   * Размер части. Минимум у S3/MinIO — 5 МиБ (последняя часть может быть меньше), меньше
   * брать нельзя. 10 МБ даёт 50 частей на предельные 500 МБ: столько ссылок ещё выдаётся
   * одним запросом, а потеря части при обрыве стоит десяти мегабайт, а не ста.
   */
  MULTIPART_PART_BYTES: 10 * 1024 * 1024,
  /** Потолок частей в одном объекте. Защита от запроса на миллион подписей. */
  MULTIPART_MAX_PARTS: 100,
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
    // AAC в MP4-контейнере: iOS пишет голосовые в .m4a (file-type: `ftyp M4A ` → audio/x-m4a),
    // аудиокниги и Flash-аудио file-type называет audio/mp4.
    AUDIO: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-m4a', 'audio/mp4'],
    // Архивы — так их называет file-type по magic bytes. DOCX/XLSX/PPTX внутри тоже zip, но
    // детектор узнаёт их по содержимому и относит к документам, а не сюда.
    ARCHIVE: [
      'application/zip',
      'application/x-rar-compressed',
      'application/x-7z-compressed',
      'application/gzip',
      'application/x-tar',
      'application/x-bzip2',
      'application/x-xz',
    ],
  },
  /**
   * Категории «по приглашению»: сервер принимает их, только если вызывающий модуль явно
   * разрешил (`allowArchives` в FileService). Архив — контейнер, чьё содержимое сервер не
   * проверяет, и в аватаре, портфолио или документе вуза ему не место. Место ему — во
   * вложениях чата, где файлами и обмениваются.
   */
  OPT_IN_CATEGORIES: ['ARCHIVE'],
} as const

export type FileCategory = keyof typeof FILE_UPLOAD.MAX_BYTES

/**
 * Квота медиа профиля на пользователя: фото и видео вкладок профиля (бакет profile-media,
 * публичный). Лимиты категории в FILE_UPLOAD ограничивают один файл, а не сумму: без квоты
 * один аккаунт мог залить в публичный бакет сколько угодно роликов.
 *
 * Сервер проверяет квоту на загрузке, presign и подтверждении прямой загрузки (409 CONFLICT
 * с `details[0].field = 'profileMediaQuota'`), клиент — до отправки, по уже загруженному.
 */
export const PROFILE_MEDIA_QUOTA = {
  /**
   * Файлов на пользователя. Равен потолку списка медиа профиля (PROFILE_LIST_LIMITS.media в
   * shared-schemas): список отдаётся без страниц, и сверх потолка загруженное не видно во
   * вкладке — его нельзя ни посмотреть, ни удалить из интерфейса. Поднимать вместе со
   * страничной выдачей списка.
   */
  MAX_FILES: 300,
  /** Суммарный объём файлов пользователя, байты (обложки видео не считаются). */
  MAX_BYTES: 2 * 1024 * 1024 * 1024,
} as const

/** Поле `details` ответа 409, по которому клиент узнаёт превышение квоты медиа профиля. */
export const PROFILE_MEDIA_QUOTA_FIELD = 'profileMediaQuota'

/** Быстрый набор эмодзи-реакций для сообщений чата (Ф9+). Единый для бэка (валидация UI) и фронта. */
export const CHAT_REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🔥', '👀'] as const

/** Окно редактирования сообщения после отправки (Ф9+), мс. Единый источник для бэка и фронта. */
export const MESSAGE_EDIT_WINDOW_MS = 10 * 60 * 1000

export const SUPPORTED_LOCALES = ['ru', 'kk', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'ru'
