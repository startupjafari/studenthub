/**
 * Лендинг StudentHub — публичный сайт, отдельный от платформы.
 *
 * Почему не `output: 'export'` (как предполагала первая редакция концепции): статический
 * экспорт не поддерживает `redirects()`, а редиректы здесь не украшение. На дверях вузов
 * уже висят напечатанные QR-наклейки со ссылками на прежний домен (docs/PROJECT.md §3.9),
 * перепечатать их нельзя — значит сервер обязан увести такой запрос на платформу. Страницы
 * лендинга всё равно статические (SSG): динамических данных на них нет.
 */

/** Платформа: на неё уходят и кнопки «Войти», и редиректы со старых публичных путей. */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/**
 * Корневые сегменты, принадлежащие платформе. Список сверен с `apps/web/src/app/**` и
 * `PUBLIC_PATHS` в `apps/web/src/middleware.ts`. Это единственное место, где лендинг вообще
 * знает о существовании путей платформы, и знание здесь декларативное — не импорт кода.
 *
 * `/r` и `/verify` критичны: их печатают на бумаге (QR над дверью, код на бланке справки).
 */
const PLATFORM_SEGMENTS = [
  'login',
  'register',
  'setup-2fa',
  'offline',
  'employer',
  'verify',
  'r',
  'qr',
  'join-chat',
  'dean',
  'teacher',
  'starosta',
  'university-admin',
  'platform-admin',
  'moderator',
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Страницы лендинга неизменяемы между сборками — сжатие тут выигрывает у всего остального.
  compress: true,

  // Минимальный self-contained сервер для production-образа (apps/landing/Dockerfile):
  // Next кладёт в .next/standalone только то, что действительно нужно на проде.
  output: 'standalone',

  // Монорепо: трейсинг зависимостей считается от корня воркспейса, иначе standalone
  // не находит node_modules, поднятые pnpm на уровень выше приложения.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,

  // Линтинг — отдельным шагом (корневой ESLint и CI), не во время next build: иначе
  // одна и та же проверка гоняется дважды и удлиняет сборку образа.
  eslint: { ignoreDuringBuilds: true },

  async redirects() {
    return PLATFORM_SEGMENTS.flatMap((segment) => [
      {
        source: `/${segment}`,
        destination: `${APP_URL}/${segment}`,
        // 308: постоянный редирект с сохранением метода. Ссылки живут на бумаге и в письмах,
        // поэтому браузеры и поисковики должны запомнить перенос навсегда.
        permanent: true,
      },
      {
        source: `/${segment}/:path*`,
        destination: `${APP_URL}/${segment}/:path*`,
        permanent: true,
      },
    ])
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Лендинг не запрашивает ни камеру, ни геолокацию, ни микрофон.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default nextConfig
