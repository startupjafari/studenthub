/**
 * Точки соприкосновения с внешним миром. Всё, что лендинг знает о платформе, —
 * её адрес; кода и контрактов он не знает (граница держится линтером, см. корневой
 * eslint.config.mjs).
 */

/**
 * Приводит адрес из переменной окружения к виду, пригодному для `new URL()`.
 *
 * Хостинги отдают публичный домен голым, без схемы: у Railway это `RAILWAY_PUBLIC_DOMAIN`
 * вида `studenthub-landing-production.up.railway.app`. Подставить такую строку в
 * переменную — первое, что делает человек, и сборка падает с `ERR_INVALID_URL` на
 * `metadataBase`, где адрес разбирается конструктором URL.
 *
 * Ошибка при этом вылезает не там, где причина: «Failed to collect page data for /en»
 * ничего не говорит о схеме. Поэтому чиним данные на входе, а не ловим исключение
 * в трёх местах.
 *
 * Хвостовой слэш срезается: иначе canonical получается вида `https://site.kz//kk`.
 */
function normalizeOrigin(value: string | undefined, fallback: string): string {
  const raw = value?.trim()
  if (!raw) return fallback

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  return withScheme.replace(/\/+$/, '')
}

/** Адрес платформы. На проде — поддомен (app.studenthub.kz), в dev — локальный web:3000. */
export const APP_URL = normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL, 'http://localhost:3000')

/** Канонический адрес самого лендинга — нужен метаданным и sitemap. */
export const SITE_URL = normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL, 'http://localhost:3002')

/** Куда писать за демонстрацией, пока форма не подключена к API (PR 5). */
export const SALES_EMAIL = process.env.NEXT_PUBLIC_SALES_EMAIL ?? 'hello@studenthub.app'

/**
 * Три двери на платформу. Пути сверены с `PUBLIC_PATHS` в apps/web/src/middleware.ts —
 * это единственные адреса продукта, которые можно открыть без аккаунта.
 */
export const PLATFORM_LINKS = {
  login: `${APP_URL}/login`,
  employerSignup: `${APP_URL}/employer/signup`,
  verifyDocument: `${APP_URL}/verify`,
} as const

export const LOCALES = ['ru', 'kk', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'ru'

/**
 * Путь языковой версии. Русская лежит в корне (основной рынок — вузы Казахстана и СНГ),
 * остальные — под префиксом. Префикса для `ru` нет намеренно: дублировать корень
 * страницей `/ru` значит заводить две канонические записи об одном и том же.
 */
export function localePath(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? '/' : `/${locale}`
}
