import createNextIntlPlugin from 'next-intl/plugin'
import withPWAInit from '@ducanh2912/next-pwa'

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

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
  async rewrites() {
    const target = process.env.API_PROXY_TARGET?.replace(/\/$/, '')
    if (!target) return []
    return [{ source: '/api/:path*', destination: `${target}/api/:path*` }]
  },
}

export default withPWA(withNextIntl(nextConfig))
