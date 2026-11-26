import type { PlatformLocalizedText } from '../model/state'

/**
 * Текст объявления на языке читателя — по коду приложения (`useAppLocale()`). Админ пишет
 * его сразу на трёх языках (сервер не отдаёт неполный набор), поэтому подстановки «нет
 * перевода» здесь нет — фолбэк на русский нужен только для незнакомой локали.
 */
export function pickPlatformText(text: PlatformLocalizedText, locale: string): string {
  if (locale === 'kz') return text.kz
  if (locale === 'en') return text.en
  return text.ru
}
