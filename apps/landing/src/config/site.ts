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
 * Хвостовой слэш срезается: иначе canonical получается вида `https://site.kz//kz`.
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

/**
 * Куда писать, если человек хочет сначала поговорить, а не заполнять форму.
 *
 * `||`, а не `??`: Docker-сборка объявляет переменную через ARG → ENV, и незаданный
 * build-arg приезжает пустой строкой, а не `undefined`. С `??` пустая строка проходила
 * насквозь, и ссылка становилась `mailto:` без адресата.
 */
export const SALES_EMAIL = process.env.NEXT_PUBLIC_SALES_EMAIL?.trim() || 'hello@studenthub.app'

export const LOCALES = ['ru', 'kz', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'ru'

/**
 * Казахский на сайте — `kz` (адрес `/kz`, параметр `?lang=kz` для платформы), а браузеры,
 * поисковики и Intl знают его только по коду ISO 639-1 `kk`: `<html lang="kz">` и
 * `hreflang="kz"` для них — неизвестный язык. Переход через эту границу — только здесь.
 *
 * Своя копия, а не `toPlatformLanguage` из `@studenthub/shared-config`: лендинг не зависит
 * от пакетов платформы (граница держится линтером, см. корневой eslint.config.mjs).
 */
const PLATFORM_LANGUAGES: Record<Locale, string> = { ru: 'ru', kz: 'kk', en: 'en' }

/** Код сайта → языковой тег платформы: `kz` → `kk`. Для `lang`, `hreflang`, `inLanguage`. */
export function toPlatformLanguage(locale: Locale): string {
  return PLATFORM_LANGUAGES[locale]
}

/**
 * Названия языков — каждое на своём языке, поэтому одинаковые на всех версиях сайта.
 * Живут здесь, а не в словаре: их показывает клиентский переключатель языка, и импорт
 * словарей ради трёх слов увозил в клиентский бандл тексты всех трёх языков целиком.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  ru: 'Русский',
  kz: 'Қазақша',
  en: 'English',
}

/** Локаль Open Graph — в формате `язык_СТРАНА` по коду платформы (`kk_KZ`), а не код сайта. */
export const OG_LOCALES: Record<Locale, string> = {
  ru: 'ru_RU',
  kz: 'kk_KZ',
  en: 'en_US',
}

/**
 * Ссылки на платформу. Пути сверены с `PUBLIC_PATHS` в apps/web/src/middleware.ts —
 * это единственные адреса продукта, которые можно открыть без аккаунта.
 *
 * Каждая ссылка несёт язык страницы (`?lang=`): у платформы свой домен, язык она берёт из
 * своей cookie, и без параметра человек с казахской версии сайта попадал на русский вход.
 * Middleware платформы переносит параметр в cookie и убирает из адреса.
 */
export function platformLinks(locale: Locale) {
  const link = (path: string) => `${APP_URL}${path}?lang=${locale}`
  return {
    login: link('/login'),
    /**
     * Заявка вуза на тестирование. Форма живёт на платформе, а не здесь, и это решение:
     * лендинг — статическая страница без единой формы, у него другой домен и другой
     * деплой. На платформе origin уже разрешён, а персональные данные лежат там, где для
     * них есть правила.
     */
    demoRequest: link('/demo'),
    employerSignup: link('/employer/signup'),
    verifyDocument: link('/verify'),
    /**
     * Юридические документы — публичные страницы платформы (`LEGAL_ROUTES` в
     * apps/web/src/shared/config/routes.ts), открываются без входа и вошедшим тоже.
     * Своего переключателя языка у них нет: текст берётся из cookie платформы, поэтому
     * `?lang=` здесь нужен так же, как у входа.
     */
    privacy: link('/legal/privacy'),
    terms: link('/legal/terms'),
  } as const
}

/**
 * Путь языковой версии. Русская лежит в корне (основной рынок — вузы Казахстана и СНГ),
 * остальные — под префиксом. Префикса для `ru` нет намеренно: дублировать корень
 * страницей `/ru` значит заводить две канонические записи об одном и том же.
 */
export function localePath(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? '/' : `/${locale}`
}
