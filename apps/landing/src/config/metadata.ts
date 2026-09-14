import type { Metadata } from 'next'
import { LOCALES, SITE_URL, localePath, type Locale } from './site'
import { getDictionary } from '../content'

/**
 * Метаданные языковой версии.
 *
 * `alternates.languages` — это и есть hreflang. На платформе его сделать нельзя: там
 * маршруты сознательно живут без locale-префикса, а язык берётся из cookie. У лендинга
 * три отдельных адреса, поэтому поисковик наконец может узнать, что это одна страница
 * на трёх языках, а не три разных.
 */
export function buildMetadata(locale: Locale): Metadata {
  const dict = getDictionary(locale)

  const languages = Object.fromEntries(LOCALES.map((l) => [l, localePath(l)]))

  return {
    metadataBase: new URL(SITE_URL),
    title: dict.meta.title,
    description: dict.meta.description,
    alternates: {
      canonical: localePath(locale),
      languages: {
        ...languages,
        // Кому не подошёл ни один язык — русская версия как основная.
        'x-default': localePath('ru'),
      },
    },
    openGraph: {
      type: 'website',
      siteName: 'StudentHub',
      title: dict.meta.title,
      description: dict.meta.description,
      locale,
      url: localePath(locale),
    },
    twitter: {
      card: 'summary_large_image',
      title: dict.meta.title,
      description: dict.meta.description,
    },
    icons: {
      icon: '/icon.svg',
    },
  }
}
