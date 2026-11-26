import { useLocale } from 'next-intl'
import { DEFAULT_LOCALE, fromPlatformLanguage, type Locale } from '@studenthub/shared-config'

/**
 * Язык приложения: `ru | kz | en` — то, что уходит в API (`locale` запросов и профиля) и
 * выбирает данные по языку (`nameKz`, `{ ru, kz, en }` объявлений, ноты релизов).
 *
 * next-intl держит не его, а языковой тег платформы — `kk` для казахского
 * (src/i18n/request.ts), потому что его locale уходит в Intl. Отсюда правило:
 * `useLocale()` — для Intl, `toLocale*String` и прочего форматирования; этот хук — для
 * всего остального. Перепутать дорого и незаметно: по тегу платформы поле `nameKz` не
 * найдётся, и казахский интерфейс молча покажет русский текст.
 */
export function useAppLocale(): Locale {
  return fromPlatformLanguage(useLocale()) ?? DEFAULT_LOCALE
}
