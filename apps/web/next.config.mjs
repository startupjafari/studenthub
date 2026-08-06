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
  fallbacks: { document: '/offline' },
  workboxOptions: {
    runtimeCaching: [
      {
        // Расписание — сначала сеть, при офлайне отдаём кэш (docs/IMPLEMENTATION_PLAN.md 13.2).
        urlPattern: /\/api\/v1\/schedule(\/|\?|$)/,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'schedule-api',
          networkTimeoutSeconds: 5,
          expiration: { maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 },
        },
      },
    ],
  },
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Линтинг — отдельным шагом (root ESLint / CI), не во время next build.
  eslint: { ignoreDuringBuilds: true },
  // Минимальный self-contained сервер для production-образа (docker/apps/web/Dockerfile).
  output: 'standalone',
  // Монорепо: трейсинг зависимостей от корня воркспейса.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
}

export default withPWA(withNextIntl(nextConfig))
