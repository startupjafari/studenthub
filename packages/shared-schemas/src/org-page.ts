import { z } from 'zod'
import { vm } from './validation-messages.js'

// Страница организации (компания, университет) в стиле профиля: общие поля витрины —
// описание, сайт, год основания, контакты и соцсети. Одна схема на обе страницы, чтобы
// правила полей (что очищается, какие ссылки допустимы) не разъехались.

/** Год основания: не раньше 1800 и не позже текущего — будущий год значит опечатку. */
export const ORG_FOUNDED_MIN = 1800

/**
 * Текстовое поле правки, которое можно очистить: undefined — «не трогать», а `''` и null —
 * «очистить» (в базу пишется null).
 */
const clearableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v))

/** Пустая строка формы — «очистить поле» (null). */
const emptyToNull = z.literal('').transform(() => null)

/** Сайт: только http(s) — ссылку показываем кликабельной, javascript: недопустим. */
const clearableWebsite = z
  .string()
  .trim()
  .max(200)
  .url()
  .refine((v) => v.startsWith('http://') || v.startsWith('https://'), vm('validation.url.httpOnly'))
  .nullable()
  .optional()
  .or(emptyToNull)

/**
 * Ссылка соцсети — только на свой домен: поле Instagram с адресом google.com показывало бы
 * студенту кнопку Instagram, ведущую неизвестно куда. Веб собирает ссылку из логина (маска
 * с префиксом), сервер проверяет итог.
 */
export const INSTAGRAM_URL_RE = /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._]{1,30}\/?$/
export const LINKEDIN_URL_RE =
  /^https:\/\/(www\.)?linkedin\.com\/(company|school|in)\/[A-Za-z0-9\-_.%]{1,100}\/?$/

const clearableSocialUrl = (re: RegExp, message: string) =>
  z.string().trim().max(200).regex(re, message).nullable().optional().or(emptyToNull)

/** Казахстанский номер в формате маски веба: +7 (777) 777-77-77. */
export const KZ_PHONE_RE = /^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/

export const OrgPageFieldsShape = {
  description: clearableText(2000),
  website: clearableWebsite,
  foundedYear: z.coerce
    .number()
    .int()
    .min(ORG_FOUNDED_MIN)
    .refine((y) => y <= new Date().getFullYear(), vm('validation.org.foundedYearFuture'))
    .nullable()
    .optional()
    .or(emptyToNull),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(160)
    .nullable()
    .optional()
    .or(emptyToNull),
  contactPhone: z
    .string()
    .trim()
    .regex(KZ_PHONE_RE, vm('validation.phone.format'))
    .nullable()
    .optional()
    .or(emptyToNull),
  address: clearableText(200),
  // Telegram — @имя или ссылка t.me: так его и пишут на визитках.
  telegram: z
    .string()
    .trim()
    .regex(
      /^(@[A-Za-z0-9_]{4,32}|https:\/\/t\.me\/[A-Za-z0-9_]{4,32})$/,
      vm('validation.org.telegram'),
    )
    .nullable()
    .optional()
    .or(emptyToNull),
  instagram: clearableSocialUrl(INSTAGRAM_URL_RE, vm('validation.org.instagram')),
  linkedin: clearableSocialUrl(LINKEDIN_URL_RE, vm('validation.org.linkedin')),
}
