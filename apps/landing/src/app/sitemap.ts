import type { MetadataRoute } from 'next'
import { LOCALES, SITE_URL, localePath, toPlatformLanguage } from '../config/site'

/**
 * Карта сайта: три языковые версии одной страницы.
 *
 * `alternates.languages` повторяет hreflang из метаданных — поисковику нужно услышать
 * про связь версий обоими способами, иначе он считает их тремя разными страницами и
 * растаскивает вес между ними. Ключи — коды платформы (`kk`), как и в hreflang.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const languages = Object.fromEntries(
    LOCALES.map((l) => [toPlatformLanguage(l), `${SITE_URL}${localePath(l)}`]),
  )
  const lastModified = new Date()

  return LOCALES.map((locale) => ({
    url: `${SITE_URL}${localePath(locale)}`,
    lastModified,
    changeFrequency: 'monthly' as const,
    // Русская версия — основная: с неё начинают и на неё ведут ссылки.
    priority: locale === 'ru' ? 1 : 0.8,
    alternates: { languages },
  }))
}
