import { z } from 'zod'

// Контракт админского мини-аппа в Telegram.
//
// Клиент присылает сырую строку `initData` — её отдаёт Telegram, и разбирать её на
// фронте бессмысленно: доверять можно только результату проверки подписи на бэкенде.
// Поэтому здесь нет ни полей пользователя, ни роли: платформа берёт их из привязки,
// а не из того, что пришло с телефона.

/** Ограничение длины: строка Telegram укладывается в пару килобайт с большим запасом. */
const initData = z.string().min(1).max(4096)

/** Код привязки: 8 символов, выдаётся в вебе, живёт минуты. Регистр не важен. */
export const MINI_LINK_CODE_LENGTH = 8

export const MiniSessionSchema = z.object({
  initData,
})

export const MiniLinkSchema = z.object({
  initData,
  code: z
    .string()
    .trim()
    .toUpperCase()
    .length(MINI_LINK_CODE_LENGTH, `Код привязки — ${MINI_LINK_CODE_LENGTH} символов`),
})
