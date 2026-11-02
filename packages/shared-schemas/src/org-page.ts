import { z } from 'zod'

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
  .refine((v) => v.startsWith('http://') || v.startsWith('https://'), 'Ссылка должна быть http(s)')
  .nullable()
  .optional()
  .or(emptyToNull)

/** Ссылка соцсети: только https. */
const clearableHttpsUrl = z
  .string()
  .trim()
  .max(200)
  .url()
  .refine((v) => v.startsWith('https://'), 'Ссылка должна начинаться с https://')
  .nullable()
  .optional()
  .or(emptyToNull)

export const OrgPageFieldsShape = {
  description: clearableText(2000),
  website: clearableWebsite,
  foundedYear: z.coerce
    .number()
    .int()
    .min(ORG_FOUNDED_MIN)
    .refine((y) => y <= new Date().getFullYear(), 'Год из будущего')
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
    .regex(/^\+?[0-9\s()-]{6,24}$/, 'Номер телефона')
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
      '@имя или https://t.me/имя',
    )
    .nullable()
    .optional()
    .or(emptyToNull),
  instagram: clearableHttpsUrl,
  linkedin: clearableHttpsUrl,
}
