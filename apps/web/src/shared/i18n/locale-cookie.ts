import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@studenthub/shared-config'

// Язык интерфейса живёт в cookie NEXT_LOCALE — её читает next-intl на сервере
// (src/i18n/request.ts). Источник истины при этом в профиле (`User.locale`): письма и push
// уходят с сервера, когда открытой вкладки нет, и cookie браузера им недоступна.
//
// Значит, cookie — не хранилище, а переносчик: при входе её приводят к профилю, при смене
// языка пишут обе стороны. Иначе человек, зашедший с нового устройства, видел бы интерфейс
// на русском, а письма получал на казахском — и наоборот.

export const LOCALE_COOKIE = 'NEXT_LOCALE'

/** Год: язык выбирают редко, и переживать закрытие вкладки он обязан. */
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60

export function readLocaleCookie(): Locale | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`))
  const value = match?.[1] ? decodeURIComponent(match[1]) : null
  return SUPPORTED_LOCALES.includes(value as Locale) ? (value as Locale) : null
}

export function writeLocaleCookie(locale: string): void {
  if (typeof document === 'undefined') return
  // Без Secure: на localhost его нет, а в проде cookie и так уходит только по https.
  // HttpOnly тоже нет — её пишет и читает клиент, в этом вся её роль.
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`
}

/**
 * Привести cookie к языку из профиля. Возвращает true, если язык поменялся — вызывающий
 * решает, нужен ли перерендер.
 *
 * Профиль главнее cookie, а не наоборот: cookie принадлежит браузеру, профиль — человеку.
 * Зашёл с чужого ноутбука — интерфейс должен стать его, а не остаться хозяйским.
 */
export function syncLocaleCookieFromProfile(profileLocale: string | null | undefined): boolean {
  const next = SUPPORTED_LOCALES.includes(profileLocale as Locale)
    ? (profileLocale as Locale)
    : DEFAULT_LOCALE
  if (readLocaleCookie() === next) return false
  writeLocaleCookie(next)
  return true
}
