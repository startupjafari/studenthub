import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'
import { DEFAULT_LOCALE, fromPlatformLanguage, toPlatformLanguage } from '@studenthub/shared-config'
import { LOCALE_COOKIE } from '../shared/i18n/locale-cookie'

// i18n без locale-префикса в URL: язык берём из cookie NEXT_LOCALE, иначе дефолт (ru).
// Маршруты остаются ролевыми (docs/PROJECT.md §12), а не /[locale]/....
export default getRequestConfig(async () => {
  const store = await cookies()
  // Код приложения (`ru | kz | en`). Через fromPlatformLanguage, а не сравнением со списком:
  // у тех, кто выбрал казахский до перехода на `kz`, в cookie лежит `kk` — язык у них
  // не должен сброситься на русский.
  const locale = fromPlatformLanguage(store.get(LOCALE_COOKIE)?.value) ?? DEFAULT_LOCALE

  const messages = (await import(`../../messages/${locale}.json`)).default

  // next-intl получает не код приложения, а языковой тег платформы (`kk` для казахского):
  // его locale уходит прямиком в Intl — плюралы и `#` в ICU-сообщениях, useFormatter,
  // `<html lang>`, а `Intl.*('kz')` молча откатывается на английский. Поэтому `useLocale()`
  // — для Intl и `toLocale*String`; код приложения (API, поля `nameKz`, словари контента)
  // даёт `useAppLocale()` из shared/i18n/app-locale.ts.
  //
  // Явный timeZone обязателен для стабильного форматирования дат на сервере и клиенте
  // (без него next-intl бросает ENVIRONMENT_FALLBACK). Платформа — вузы Казахстана.
  return { locale: toPlatformLanguage(locale), messages, timeZone: 'Asia/Almaty' }
})
