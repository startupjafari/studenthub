import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@studenthub/shared-config'

// i18n без locale-префикса в URL: язык берём из cookie NEXT_LOCALE, иначе дефолт (ru).
// Маршруты остаются ролевыми (docs/PROJECT.md §12), а не /[locale]/....
export default getRequestConfig(async () => {
  const store = await cookies()
  const fromCookie = store.get('NEXT_LOCALE')?.value
  const locale: Locale = SUPPORTED_LOCALES.includes(fromCookie as Locale)
    ? (fromCookie as Locale)
    : DEFAULT_LOCALE

  const messages = (await import(`../../messages/${locale}.json`)).default

  // Явный timeZone обязателен для стабильного форматирования дат на сервере и клиенте
  // (без него next-intl бросает ENVIRONMENT_FALLBACK). Платформа — вузы Казахстана.
  return { locale, messages, timeZone: 'Asia/Almaty' }
})
