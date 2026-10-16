// Параметры единой медиа-системы. Источник истины — docs/PROJECT.md «Медиа».
//
// Числа живут в API, а не в shared-config: клиент их не знает и знать не должен — он берёт
// готовый список вариантов из ответа и сам выбирает подходящий через srcset.

/**
 * Ширины уменьшенных копий изображения, px. Каждая — только если оригинал заметно шире
 * (см. `planImageWidths`): апскейл раздувает байты, ничего не добавляя к картинке.
 *
 * 320 — миниатюры сеток и календаря, 640 — пузырь чата и карточка ленты на телефоне,
 * 1280 — лента на десктопе и просмотрщик на телефоне, 2048 — просмотрщик на большом экране.
 */
export const IMAGE_WIDTHS = [320, 640, 1280, 2048] as const

/** Качество WebP: на фотографиях 75–80 визуально неотличимо от оригинала. */
export const IMAGE_WEBP_QUALITY = 78

/** Сторона LQIP-заглушки, px. 16 даёт силуэт и цвета, data-URI укладывается в ~300 байт. */
export const PLACEHOLDER_SIZE = 16
export const PLACEHOLDER_WEBP_QUALITY = 40

/** Ширины постера видео, px. Оригинальная ширина кадра добавляется, если она меньше. */
export const POSTER_WIDTHS = [640, 1280] as const

/**
 * Лесенка HLS: рендишн по короткой стороне кадра — «720p» у вертикального ролика 720×1280
 * значит ширину 720. Битрейты — потолок для capped-CRF: спокойная сцена занимает меньше.
 */
export const HLS_LADDER = [
  { short: 360, videoKbps: 800, audioKbps: 96 },
  { short: 480, videoKbps: 1400, audioKbps: 96 },
  { short: 720, videoKbps: 2800, audioKbps: 128 },
  { short: 1080, videoKbps: 5000, audioKbps: 128 },
] as const

/** Длина сегмента HLS, с. 4 — компромисс между скоростью старта и числом запросов. */
export const HLS_SEGMENT_SECONDS = 4

/** Сколько живёт токен доступа к плейлисту: столько же, сколько presigned-ссылка. */
export const HLS_TOKEN_TTL_SECONDS = 15 * 60

/**
 * Бакеты, медиа которых обрабатывается. Аватары — нет: у них своя джоба превью и
 * квадратная обрезка ещё на клиенте; документы и заявки — тоже нет, это сканы, их
 * открывают целиком.
 */
export const MEDIA_BUCKET_KEYS = [
  'MINIO_BUCKET_CHAT',
  'MINIO_BUCKET_POSTS',
  'MINIO_BUCKET_STORIES',
  'MINIO_BUCKET_PROFILE_MEDIA',
  'MINIO_BUCKET_MATERIALS',
] as const

/** Бакеты с анонимным чтением: ссылки на их варианты — постоянные публичные URL. */
export const PUBLIC_MEDIA_BUCKET_KEYS = [
  'MINIO_BUCKET_AVATARS',
  'MINIO_BUCKET_PROFILE_MEDIA',
  'MINIO_BUCKET_PROFILE_COVERS',
] as const

/**
 * Cache-Control вариантов. Ключ варианта содержит id файла и размер и никогда не
 * перезаписывается другим содержимым, поэтому кешировать можно «навсегда».
 */
export const VARIANT_CACHE_CONTROL = 'public, max-age=31536000, immutable'
