import createNextIntlPlugin from 'next-intl/plugin'
import withPWAInit from '@ducanh2912/next-pwa'
import { withSentryConfig } from '@sentry/nextjs'

// Плагин next-intl указывает на src/i18n/request.ts (i18n без locale-префикса в URL).
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// PWA (задача 13.2): service worker в public/, офлайн-фолбэк, кэш расписания NetworkFirst.
// В dev отключён, чтобы не мешать HMR.
const withPWA = withPWAInit({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  cacheOnFrontEndNav: true,
  // Кастомный код SW (Web Push: push/notificationclick) — из apps/web/worker/, компилируется
  // next-pwa и подключается в sw.js (Ф13.3).
  customWorkerSrc: 'worker',
  fallbacks: { document: '/offline' },
  workboxOptions: {
    // Новый SW обязан ЖДАТЬ решения пользователя, а не подменять себя сам.
    //
    // Дефолт next-pwa — skipWaiting: true, и он противоречит остальному коду: SW
    // активировался бы сразу, clientsClaim перехватывал бы открытую страницу, а наш
    // обработчик controllerchange перезагружал бы её под руками — посреди набора
    // сообщения или заполнения формы. Именно от этого предостерегает комментарий в
    // use-sw-update.ts, но конфигурация делала ровно обратное.
    //
    // false — ждущий SW стоит и ничего не трогает, пока человек не нажмёт «Обновить»
    // (тост или кнопка в настройках). Тогда страница шлёт SKIP_WAITING (worker/index.ts),
    // SW активируется, controllerchange перезагружает — уже по согласию.
    skipWaiting: false,
    // Офлайн-кэш только для полезных сценариев чтения (docs/UNIFIED_UX.md PR-10/#16):
    // расписание, Student Pass, «Сегодня», недавние материалы/задания, часть истории
    // сообщений. Все — NetworkFirst и ТОЛЬКО GET → мутации (POST/PUT/PATCH/DELETE) не
    // перехватываются и выполняются только online.
    runtimeCaching: [
      {
        // Расписание — сначала сеть, при офлайне отдаём кэш (docs/IMPLEMENTATION_PLAN.md 13.2).
        urlPattern: /\/api\/v1\/schedule(\/|\?|$)/,
        handler: 'NetworkFirst',
        method: 'GET',
        options: {
          cacheName: 'schedule-api',
          networkTimeoutSeconds: 5,
          expiration: { maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 },
        },
      },
      {
        // Цифровой студенческий (карта показывается офлайн; QR-токен обновится при сети).
        urlPattern: /\/api\/v1\/student-id\/me(\?|$)/,
        handler: 'NetworkFirst',
        method: 'GET',
        options: {
          cacheName: 'student-pass-api',
          networkTimeoutSeconds: 5,
          expiration: { maxEntries: 2, maxAgeSeconds: 24 * 60 * 60 },
        },
      },
      {
        // Операционный экран «Сегодня» (BFF) — последний известный день офлайн.
        urlPattern: /\/api\/v1\/me\/today(\?|$)/,
        handler: 'NetworkFirst',
        method: 'GET',
        options: {
          cacheName: 'me-today-api',
          networkTimeoutSeconds: 5,
          expiration: { maxEntries: 4, maxAgeSeconds: 6 * 60 * 60 },
        },
      },
      {
        // Недавно открытые материалы (список + метаданные).
        urlPattern: /\/api\/v1\/materials(\/|\?|$)/,
        handler: 'NetworkFirst',
        method: 'GET',
        options: {
          cacheName: 'materials-api',
          networkTimeoutSeconds: 5,
          expiration: { maxEntries: 48, maxAgeSeconds: 24 * 60 * 60 },
        },
      },
      {
        // Задания и своя сдача (черновик читается офлайн; отправка — только online).
        urlPattern: /\/api\/v1\/assignments(\/|\?|$)/,
        handler: 'NetworkFirst',
        method: 'GET',
        options: {
          cacheName: 'assignments-api',
          networkTimeoutSeconds: 5,
          expiration: { maxEntries: 48, maxAgeSeconds: 12 * 60 * 60 },
        },
      },
      {
        // Часть истории сообщений (последние открытые чаты).
        urlPattern: /\/api\/v1\/chats\/[^/]+\/messages(\?|$)/,
        handler: 'NetworkFirst',
        method: 'GET',
        options: {
          cacheName: 'chat-messages-api',
          networkTimeoutSeconds: 5,
          expiration: { maxEntries: 100, maxAgeSeconds: 24 * 60 * 60 },
        },
      },
    ],
  },
})

// Версия сборки. Railway отдаёт SHA коммита; локально берём метку времени, чтобы две
// сборки подряд всё-таки отличались. Значение видно в настройках и в консоли — без него
// невозможно ответить на вопрос «а обновилось ли вообще», а именно он и возникает, когда
// приложение с домашнего экрана неделями не перезапускают.
const buildId = (
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GIT_COMMIT_SHA ||
  `dev-${Date.now().toString(36)}`
).slice(0, 12)

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Тот же идентификатор, что показывается пользователю, становится и buildId Next:
  // ссылки на чанки меняются вместе с ним, значит меняется и precache-манифест SW.
  generateBuildId: () => buildId,
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  // Отдельная папка сборки для e2e-стенда (NEXT_DIST_DIR=.next-e2e): позволяет держать
  // прогон Playwright и обычный `pnpm dev` одновременно — иначе два процесса Next дерутся
  // за общий `.next`. В обычном режиме переменной нет и путь прежний.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Линтинг — отдельным шагом (root ESLint / CI), не во время next build.
  eslint: { ignoreDuringBuilds: true },
  // Минимальный self-contained сервер для production-образа (docker/apps/web/Dockerfile).
  output: 'standalone',
  // Монорепо: трейсинг зависимостей от корня воркспейса.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  // Единый origin: браузер ходит на /api/* СВОЕГО домена, web проксирует их на api.
  // Так auth-cookie (sh_refresh, sh_role) становятся first-party и видны middleware,
  // а CORS для HTTP не нужен. Цель читается на этапе build (Dockerfile ARG
  // API_PROXY_TARGET). Без неё (dev) rewrite не добавляется — ходим напрямую.
  // Сам файл service worker кешировать нельзя. Браузер сверяет его побайтово, и если
  // между ним и пользователем окажется прокси или CDN, отдающий вчерашнюю копию, новый
  // SW не будет обнаружен вообще — приложение останется на старой версии навсегда, и
  // никакая кнопка «обновить» не поможет: проверять будет нечего. Next по умолчанию
  // отдаёт файлы из public/ с max-age=0, но полагаться на умолчание здесь нельзя —
  // цена ошибки слишком велика, а заголовок бесплатный.
  async headers() {
    return [
      {
        source: '/:file(sw.js|sw.js.map|workbox-:hash*.js|worker-:hash*.js|fallback-:hash*.js)',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        // Манифест меняется редко, но устаревший ломает вид уже установленного ярлыка.
        source: '/manifest.webmanifest',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
    ]
  },

  async rewrites() {
    const target = process.env.API_PROXY_TARGET?.replace(/\/$/, '')
    if (!target) return []
    return [{ source: '/api/:path*', destination: `${target}/api/:path*` }]
  },
}

// Sentry (Ф13.8) — самый внешний слой: ему нужен уже собранный webpack-конфиг, чтобы
// подложить плагин загрузки source maps. Без SENTRY_AUTH_TOKEN загрузка карт молча
// пропускается, сборка не падает — так собирается dev и CI без секретов.
export default withSentryConfig(withPWA(withNextIntl(nextConfig)), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Без source maps стектрейс минифицирован и бесполезен. Карты загружаются в Sentry
  // и удаляются из сборки, чтобы не отдавать исходники браузеру.
  sourcemaps: { deleteSourcemapFilesAfterUpload: true },

  // Прокси-роут на своём домене: мобильные блокировщики рекламы и корпоративные DNS
  // режут запросы к *.sentry.io, и ошибки с телефонов просто не доходили бы.
  tunnelRoute: '/monitoring',

  // Логи самого плагина в консоль сборки — только если что-то пошло не так.
  silent: !process.env.CI,

  webpack: {
    treeshake: {
      // Вырезать внутренние debug-логи SDK из бандла (меньше кода в браузере).
      removeDebugLogging: true,
      // Трейсинг производительности выключен (см. tracesSampleRate в shared/lib/
      // sentry-options.ts) — вырезаем и его код. Условие, а не жёсткое true: иначе
      // включение сэмплирования через env не заработало бы, а причину пришлось бы
      // искать долго. Sample rate тоже читается на сборке, так что решение согласовано.
      removeTracing: !Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE),
    },
  },
})
