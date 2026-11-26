import { DEFAULT_LOCALE, fromPlatformLanguage, type Locale } from '@studenthub/shared-config'

// Язык интерфейса живёт в cookie NEXT_LOCALE — её читает next-intl на сервере
// (src/i18n/request.ts). Источник истины при этом в профиле (`User.locale`): письма и push
// уходят с сервера, когда открытой вкладки нет, и cookie браузера им недоступна.
//
// Значит, cookie — не хранилище, а переносчик: при входе её приводят к профилю, при смене
// языка пишут обе стороны. Иначе человек, зашедший с нового устройства, видел бы интерфейс
// на русском, а письма получал на казахском — и наоборот.
//
// В cookie лежит код приложения (`ru | kz | en`). До перехода на `kz` казахский писался как
// `kk`, и такие cookie ещё живут в браузерах: читаем их через fromPlatformLanguage, чтобы
// язык не сбросился, а при синхронизации с профилем переписываем на новый код.

export const LOCALE_COOKIE = 'NEXT_LOCALE'

/** Год: язык выбирают редко, и переживать закрытие вкладки он обязан. */
export const LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60

/**
 * Параметр, которым язык приезжает с лендинга: у сайта свой домен, и поставить cookie
 * платформы он не может. Middleware переносит его в cookie и убирает из адреса.
 */
export const LOCALE_PARAM = 'lang'

/** Значение cookie как есть, без приведения — нужно, чтобы заметить старое `kk`. */
function rawLocaleCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`))
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

export function readLocaleCookie(): Locale | null {
  return fromPlatformLanguage(rawLocaleCookie())
}

export function writeLocaleCookie(locale: Locale): void {
  if (typeof document === 'undefined') return
  // Без Secure: на localhost его нет, а в проде cookie и так уходит только по https.
  // HttpOnly тоже нет — её пишет и читает клиент, в этом вся её роль.
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`
}

/**
 * Привести cookie к языку из профиля. Возвращает true, если язык поменялся — вызывающий
 * решает, нужен ли перерендер.
 *
 * Профиль главнее cookie, а не наоборот: cookie принадлежит браузеру, профиль — человеку.
 * Зашёл с чужого ноутбука — интерфейс должен стать его, а не остаться хозяйским.
 *
 * Старое `kk` в cookie переписывается на `kz`, но сменой языка не считается: интерфейс и
 * так уже казахский, перерендер ради этого не нужен.
 */
export function syncLocaleCookieFromProfile(profileLocale: string | null | undefined): boolean {
  const next = fromPlatformLanguage(profileLocale) ?? DEFAULT_LOCALE
  const changed = readLocaleCookie() !== next
  if (rawLocaleCookie() !== next) writeLocaleCookie(next)
  return changed
}
