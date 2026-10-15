import { z } from 'zod'

const HTTP_URL = /^https?:\/\//i

/**
 * Ссылка, которую покажут другим людям: только http(s).
 *
 * Голый `z.string().url()` пропускает `javascript:alert(1)` и `data:text/html,…` — сейчас
 * `javascript:` гасит React, а `data:` верхнего уровня блокируют браузеры, но защита держится
 * на одном рубеже. Схема — первый.
 */
export function httpUrl(max: number) {
  return z
    .string()
    .trim()
    .url()
    .max(max)
    .refine((v) => HTTP_URL.test(v), { message: 'Ссылка должна быть http или https' })
}

/**
 * Сайт в профиле: http(s)-ссылка или голый домен («example.kz», «example.kz/путь»), как его
 * обычно и пишут. Отклоняются чужие схемы и протокол-относительные `//host`: такая ссылка
 * открывалась в той же вкладке на чужом домене — удобно для фишинга. Пустая строка — «не указан».
 */
const BARE_DOMAIN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/\S*)?$/i

export const WebsiteSchema = z
  .string()
  .trim()
  .max(120)
  .refine((v) => v === '' || HTTP_URL.test(v) || BARE_DOMAIN.test(v), {
    message: 'Укажите адрес сайта, например example.kz',
  })

/**
 * Адрес для href: http(s) — как есть, голому домену — https://. Всё остальное (старые
 * значения вида `//host` или с чужой схемой) ссылкой не делаем — показываем текстом.
 */
export function websiteHref(value: string | null | undefined): string | null {
  const v = value?.trim()
  if (!v) return null
  if (HTTP_URL.test(v)) return v
  return BARE_DOMAIN.test(v) ? `https://${v}` : null
}
