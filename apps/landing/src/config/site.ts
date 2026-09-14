/**
 * Точки соприкосновения с внешним миром. Всё, что лендинг знает о платформе, —
 * её адрес; кода и контрактов он не знает (граница держится линтером, см. корневой
 * eslint.config.mjs).
 */

/** Адрес платформы. На проде — поддомен (app.studenthub.kz), в dev — локальный web:3000. */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/** Канонический адрес самого лендинга — нужен метаданным и sitemap. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3002'

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
