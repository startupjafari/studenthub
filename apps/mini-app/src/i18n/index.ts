import { webApp } from '../telegram/webapp'
import { ApiError } from '../api/client'
import { LOCALES, MESSAGES, type Locale, type MessageKey } from './messages'

// Язык интерфейса.
//
// Берётся из Telegram (`initDataUnsafe.user.language_code`), а не из настроек платформы:
// мини-апп открывается ДО того, как выдана сессия, и на экране привязки платформа о
// человеке ещё ничего не знает. К тому же язык клиента Telegram — это и есть язык, на
// котором человек читает уведомления от бота.
//
// Резолвится один раз: сменить язык, не перезапустив клиент, нельзя, а пересчитывать его
// на каждый рендер значит звать в window из компонентов.

let resolved: Locale | null = null

export function locale(): Locale {
  if (resolved === null) resolved = detect()
  return resolved
}

function detect(): Locale {
  return fromPlatformLanguage(webApp()?.initDataUnsafe?.user?.language_code) ?? 'ru'
}

/**
 * Языковой тег клиента → код приложения. Казахский в приложении — `kz`, а Telegram, как и
 * всё, что следует ISO 639-1, присылает `kk`. `ru-RU` и `ru` — один язык; Telegram присылает
 * и то и другое. Неподдерживаемое — null.
 *
 * Своя копия `fromPlatformLanguage` из `@studenthub/shared-config`: мини-апп собирается
 * отдельно и от пакетов платформы не зависит.
 */
function fromPlatformLanguage(tag: string | null | undefined): Locale | null {
  const base = tag?.trim().toLowerCase().split(/[-_]/)[0]
  if (!base) return null
  if (base === 'kk' || base === 'kz') return 'kz'
  return LOCALES.find((value) => value === base) ?? null
}

/**
 * Строка по ключу. Подстановки — `{name}` в тексте; передаются значениями, а не
 * склейкой, потому что порядок слов в трёх языках разный.
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const text = MESSAGES[locale()][key]
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  )
}

// Отказы сервера, которые можно назвать своими словами. Текст `message` бэкенда — русский
// и для людей не предназначен (§8.2: клиент реагирует на `code`): в kz и en он торчал бы
// чужим языком. Чего нет в списке — то говорит запасная строка самого действия.
const ERROR_KEYS: Partial<Record<string, MessageKey>> = {
  INVALID_2FA_CODE: 'errInvalidCode',
  TWO_FACTOR_SETUP_REQUIRED: 'errTwoFactorSetup',
  RATE_LIMIT: 'errRateLimit',
  FORBIDDEN: 'errForbidden',
  WRONG_SCOPE: 'errForbidden',
  NOT_FOUND: 'errNotFound',
  CONFLICT: 'errConflict',
  SESSION_EXPIRED: 'sessionExpiredTitle',
}

/** Текст отказа по коду ответа; `fallback` — что не удалось сделать, если код не знаком. */
export function errorText(cause: unknown, fallback: MessageKey): string {
  const key = cause instanceof ApiError ? ERROR_KEYS[cause.code] : undefined
  return t(key ?? fallback)
}

/** Только для тестов: сбросить определённый язык. */
export function resetLocale(next: Locale | null = null): void {
  resolved = next
}

export { LOCALES, type Locale, type MessageKey }
