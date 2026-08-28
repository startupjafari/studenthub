import { z } from 'zod'

// Единый контракт переменных окружения (docs/PROJECT.md §13, docs/BACKEND_RULES.md §14.2).
// Валидируется на старте: отсутствие обязательной переменной = приложение не стартует.

// Булев флаг из строки: z.coerce.boolean() трактует любую непустую строку как true,
// поэтому 'false' парсим явно.
const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true')

/**
 * Необязательная переменная окружения.
 *
 * В `.env` и `.env.example` необязательные переменные принято объявлять пустыми
 * (`SENTRY_DSN=`), и такая строка приходит как `''`, а не как `undefined`. Для
 * `z.string().url().optional()` это ОТКАЗ валидации — то есть приложение не стартует
 * у любого, кто скопировал `.env.example` по инструкции первого запуска (§14).
 * Поэтому пустую строку и пробелы трактуем как «переменная не задана».
 */
const optionalEnv = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional())

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  API_PREFIX: z.string().min(1).default('api/v1'),

  DATABASE_URL: z.string().url(),
  DATABASE_URL_TEST: z.string().url().optional(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET: минимум 32 символа'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET: минимум 32 символа'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  // Ключ шифрования TOTP-секретов 2FA (AES-256-GCM). Отдельный от JWT-секретов.
  TOTP_ENCRYPTION_KEY: z.string().min(32, 'TOTP_ENCRYPTION_KEY: минимум 32 символа'),
  // Форс 2FA для привилегированных ролей (TwoFactorGuard). Безопасно по умолчанию — true.
  // В e2e/тестах выключается (setup-env.cjs). Аварийный выключатель для прода при сбое настройки 2FA.
  TWO_FACTOR_ENFORCE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // Окно грации при повторе ротированного refresh-токена (AuthService.refresh). Повтор ТОЛЬКО ЧТО
  // использованного токена — обычно не кража, а недоставленный ответ: браузер оборвал запрос
  // (навигация, закрытие вкладки, спящая мобильная вкладка), новая cookie до клиента не доехала.
  // В окне вместо разрыва цепочки выдаём новую ротацию. 0 — строгое поведение без послаблений.
  REFRESH_REUSE_GRACE_MS: z.coerce.number().int().min(0).default(10_000),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: booleanFromString,
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET_AVATARS: z.string().default('avatars'),
  MINIO_BUCKET_POSTS: z.string().default('posts-media'),
  MINIO_BUCKET_STORIES: z.string().default('stories-media'),
  MINIO_BUCKET_APPLICATIONS: z.string().default('applications'),
  MINIO_BUCKET_MATERIALS: z.string().default('materials'),
  MINIO_BUCKET_CHAT: z.string().default('chat-media'),
  MINIO_BUCKET_PROFILE_MEDIA: z.string().default('profile-media'),
  MINIO_BUCKET_PROFILE_COVERS: z.string().default('profile-covers'),
  // Документы (Ф15) — приватный бакет, доступ только по presigned-URL.
  MINIO_BUCKET_DOCUMENTS: z.string().default('documents'),

  // Публичный адрес MinIO для presigned-ссылок, отдаваемых в браузер (напр. домен
  // Railway у minio-сервиса). Если не задан — presigned генерятся на внутренний
  // MINIO_ENDPOINT (ок для dev, но в проде браузер его не резолвит).
  MINIO_PUBLIC_ENDPOINT: z.string().optional(),
  MINIO_PUBLIC_PORT: z.coerce.number().int().positive().default(443),
  MINIO_PUBLIC_USE_SSL: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // SMTP используется с Фазы 3 — пока необязателен.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  THROTTLE_TTL: z.coerce.number().int().positive().default(900),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(5),
  // Мониторинг (Ф13.8). Без SENTRY_DSN трекер не инициализируется вовсе — ни в dev,
  // ни в тестах (см. apps/api/src/instrument.ts). Схема валидирует значения на старте,
  // но instrument.ts читает их из process.env напрямую: Sentry.init обязан выполниться
  // до загрузки Nest и инструментируемых библиотек, т.е. раньше ConfigModule.
  SENTRY_DSN: optionalEnv(z.string().url()),
  /** Имя окружения в Sentry (`production`/`staging`/`pilot`). По умолчанию — NODE_ENV. */
  SENTRY_ENVIRONMENT: optionalEnv(z.string().min(1)),
  /** Версия сборки для группировки и source maps (обычно git sha). */
  SENTRY_RELEASE: optionalEnv(z.string().min(1)),
  /**
   * Доля запросов, попадающих в трейсинг производительности. По умолчанию 0 —
   * на пилоте нужны только ошибки, а трейсинг стоит квоты и добавляет накладные расходы.
   */
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

  // Служебный Telegram-бот (docs/TELEGRAM_BOT.md §1). Все переменные необязательны, и это
  // не «на всякий случай»: без TELEGRAM_BOT_TOKEN модуль ops-notify не поднимается вовсе —
  // ни воркера очереди, ни фоновых запросов (§7.3.5). Локальная разработка и CI бота не требуют.
  // На проде значения задаются в Railway, не в .env образа.
  TELEGRAM_BOT_TOKEN: optionalEnv(z.string().min(1)),
  /**
   * ID закрытой супергруппы (отрицательное число). Держим строкой: Telegram принимает
   * chat_id и строкой, а число тут ничего не даёт — арифметики над ним нет.
   */
  TELEGRAM_OPS_CHAT_ID: optionalEnv(z.string().min(1)),
  // ID тем супергруппы (message_thread_id, §3.1). Не заданы — сообщения идут в общий
  // поток группы: допустимая деградация, а не отказ.
  TELEGRAM_TOPIC_DEPLOY: optionalEnv(z.coerce.number().int().positive()),
  TELEGRAM_TOPIC_ALERTS: optionalEnv(z.coerce.number().int().positive()),
  TELEGRAM_TOPIC_DIGEST: optionalEnv(z.coerce.number().int().positive()),
  /** Метка окружения в начале сообщения (§3.6). `prod` не печатается — это норма. */
  OPS_ENV_LABEL: optionalEnv(z.string().min(1)),
  /**
   * Внешний адрес приложения для синтетического пинга (§2.2). Именно внешний: `/health`
   * изнутри отвечает и тогда, когда снаружи приложение недоступно — упал прокси, протух
   * сертификат, не резолвится домен. Не задан — проверка не заводится.
   */
  OPS_PUBLIC_URL: optionalEnv(z.string().url()),
  // Пороги проверок — в конфигурации, а не в коде (§7.4.6): их придётся крутить по факту,
  // и каждый раз это не должно быть релизом.
  OPS_QUEUE_WAITING_THRESHOLD: z.coerce.number().int().positive().default(1000),
  OPS_QUEUE_FAILED_THRESHOLD: z.coerce.number().int().positive().default(20),
  /** Сколько отказов 401/403/429 за пять минут считать всплеском (§2.4). */
  OPS_AUTH_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(50),
  /**
   * `secret_token` входящих апдейтов Telegram (заголовок `X-Telegram-Bot-Api-Secret-Token`).
   * Не задан — команды бота выключены, исходящие сообщения работают как прежде (§6).
   */
  TELEGRAM_WEBHOOK_SECRET: optionalEnv(
    z.string().min(16, 'TELEGRAM_WEBHOOK_SECRET: минимум 16 символов'),
  ),
  /**
   * Общий секрет вебхуков Railway и Sentry (заголовок `X-Ops-Secret`) и он же — ключ HMAC
   * для штатной подписи GitHub. Не задан — публичные эндпоинты приёма отвечают 401 всем:
   * открытый вход «пока не настроили» хуже отсутствующего (§5).
   */
  OPS_HOOK_SECRET: optionalEnv(z.string().min(16, 'OPS_HOOK_SECRET: минимум 16 символов')),
  /** Репозиторий в виде `owner/repo` — для шага упавшего CI и дрейфа веток (§2.1). */
  OPS_GITHUB_REPO: optionalEnv(
    z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'OPS_GITHUB_REPO: owner/repo'),
  ),
  /** Токен только на чтение репозитория. Не задан — changelog и дрейф не считаются. */
  OPS_GITHUB_TOKEN: optionalEnv(z.string().min(1)),
  OPS_GITHUB_BASE_BRANCH: z.string().default('main'),
  OPS_GITHUB_HEAD_BRANCH: z.string().default('develop'),
  /** Когда уходит вечерняя сводка (§2.3). Cron-выражение, по умолчанию 21:00. */
  OPS_DIGEST_CRON: z.string().default('0 21 * * *'),
  /** Таймзона университета: «21:00» без неё значит 21:00 UTC, то есть 03:00 в Казахстане. */
  OPS_DIGEST_TZ: z.string().default('Asia/Almaty'),

  // Web Push (Ф13.3). Без ключей push отключён (сервис молча пропускает отправку).
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@studenthub.app'),
})

export type EnvVars = z.infer<typeof envSchema>

/** Валидатор для ConfigModule.forRoot({ validate }). Бросает с перечнем проблем. */
export function validateEnv(config: Record<string, unknown>): EnvVars {
  const parsed = envSchema.safeParse(config)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`Некорректные переменные окружения:\n${issues}`)
  }
  return parsed.data
}
