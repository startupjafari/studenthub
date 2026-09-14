import type { MetadataRoute } from 'next'
import { SITE_URL } from '../config/site'

/**
 * Лендинг индексируется целиком — он для этого и сделан.
 *
 * Закрытая часть платформы живёт на другом домене и закрывается своим robots.txt; здесь
 * запрещать нечего: страница целиком публичная, и картинок с данными на ней нет.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
