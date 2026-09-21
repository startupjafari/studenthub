import { webApp } from '../telegram/webapp'
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
  // `ru-RU` и `ru` — один язык; Telegram присылает и то и другое.
  const raw = webApp()?.initDataUnsafe?.user?.language_code?.slice(0, 2).toLowerCase()
  return LOCALES.find((value) => value === raw) ?? 'ru'
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

/** Только для тестов: сбросить определённый язык. */
export function resetLocale(next: Locale | null = null): void {
  resolved = next
}

export { LOCALES, type Locale, type MessageKey }
