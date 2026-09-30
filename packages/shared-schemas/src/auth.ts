import { z } from 'zod'

// Схемы аутентификации — единый источник валидации для API (ZodValidationPipe) и форм фронта.

// Вход по email ИЛИ имени пользователя (Telegram-стиль): одно поле-идентификатор.
export const LoginSchema = z
  .object({
    identifier: z.string().min(1, 'Введите email или имя пользователя'),
    password: z.string().min(1, 'Введите пароль'),
  })
  .strict()

export type LoginInput = z.infer<typeof LoginSchema>

// Имя пользователя (Telegram-стиль): 3–32 символа, латиница/цифры/подчёркивание, регистронезависимо
// (нормализуем в нижний регистр). Основа для входа и @упоминаний в чате.
export const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,32}$/, 'Только латиница, цифры и _, 3–32 символа')

// Политика пароля (docs/BACKEND_RULES.md §3): ≥8 символов, буква + цифра + спецсимвол.
export const PasswordSchema = z
  .string()
  .min(8, 'Минимум 8 символов')
  .regex(/[A-Za-zА-Яа-я]/, 'Нужна хотя бы одна буква')
  .regex(/[0-9]/, 'Нужна хотя бы одна цифра')
  .regex(/[^A-Za-zА-Яа-я0-9]/, 'Нужен хотя бы один спецсимвол')

/**
 * Редакция правовых документов, на которую даётся согласие при регистрации.
 *
 * Дата, а не порядковый номер: её видно в самой политике («Редакция от 30 сентября 2026
 * года»), и по записи в базе понятно, какой текст человек принимал. Меняется ВМЕСТЕ с
 * текстом документов (apps/web/messages/*.json, ключ `Legal`) — иначе в базе останется
 * ссылка на редакцию, которой никто не видел.
 */
export const LEGAL_VERSION = '2026-09-30'

/** Возраст совершеннолетия в РК: до него согласие даёт законный представитель. */
export const AGE_OF_MAJORITY = 18

/** Полных лет на дату. Дата рождения — ISO `YYYY-MM-DD`. */
export function ageAt(birthDate: string, at: Date = new Date()): number {
  const [y, m, d] = birthDate.split('-').map(Number)
  let age = at.getFullYear() - (y ?? 0)
  const monthDiff = at.getMonth() + 1 - (m ?? 1)
  // День рождения ещё не наступил в этом году — год не засчитан.
  if (monthDiff < 0 || (monthDiff === 0 && at.getDate() < (d ?? 1))) age -= 1
  return age
}

/** Совершеннолетний ли человек с такой датой рождения. */
export function isAdult(birthDate: string, at: Date = new Date()): boolean {
  return ageAt(birthDate, at) >= AGE_OF_MAJORITY
}

// Регистрация по инвайту (docs/PROJECT.md §7.3): форма принимает имя пользователя, имя, пароль, фото.
// Роль и scope НЕ здесь — они берутся из инвайта на сервере. email — из инвайта либо этой формы.
//
// Дата рождения и согласие обязательны с сентября 2026. Причина не в форме, а в законе:
// согласие на обработку персональных данных лица младше 18 лет даёт законный представитель,
// и согласие самого несовершеннолетнего юридической силы не имеет. Отличить одного от
// другого можно только по дате рождения, поэтому она спрашивается здесь, а не остаётся
// необязательным полем профиля.
export const RegisterByInviteSchema = z
  .object({
    token: z.string().min(1),
    username: UsernameSchema,
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    password: PasswordSchema,
    email: z.string().email().optional(),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД'),
    /** Согласие с политикой и соглашением. Только `true`: отказ — это незаполненная форма. */
    consent: z.literal(true),
    /** Согласие законного представителя. Обязательно, если на дату регистрации нет 18. */
    guardianConsent: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const born = new Date(`${v.birthDate}T00:00:00Z`)
    if (Number.isNaN(born.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Некорректная дата',
        path: ['birthDate'],
      })
      return
    }
    const age = ageAt(v.birthDate)
    // Верхняя граница — защита от опечатки в годе, а не от долгожителей.
    if (age < 0 || age > 120) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Проверьте дату рождения',
        path: ['birthDate'],
      })
      return
    }
    if (age < AGE_OF_MAJORITY && v.guardianConsent !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Нужно согласие законного представителя',
        path: ['guardianConsent'],
      })
    }
  })

export type RegisterByInviteInput = z.infer<typeof RegisterByInviteSchema>

// ── Двухфакторная аутентификация (TOTP) ──────────────────────────────────────

// 6-значный код из приложения-аутентификатора (Google Authenticator и т.п.).
const TotpCodeSchema = z.string().regex(/^\d{6}$/, 'Код из 6 цифр')

// Второй шаг входа: challenge из ответа /auth/login + код (TOTP 6 цифр ИЛИ backup-код).
export const TwoFactorVerifySchema = z
  .object({
    challengeToken: z.string().min(1),
    code: z.string().min(6).max(20),
  })
  .strict()

export type TwoFactorVerifyInput = z.infer<typeof TwoFactorVerifySchema>

// Подтверждение подключения 2FA — только TOTP-код (backup-кодов ещё нет).
export const TwoFactorEnableSchema = z.object({ code: TotpCodeSchema }).strict()
export type TwoFactorEnableInput = z.infer<typeof TwoFactorEnableSchema>

// Отключение 2FA — TOTP-код или backup-код.
export const TwoFactorDisableSchema = z.object({ code: z.string().min(6).max(20) }).strict()
export type TwoFactorDisableInput = z.infer<typeof TwoFactorDisableSchema>

// ── Вход по QR (Telegram Web-стиль) ──────────────────────────────────────────

// Подтверждение входа с уже залогиненного устройства (телефона): approveToken из QR.
export const QrApproveSchema = z.object({ approveToken: z.string().min(1) }).strict()
export type QrApproveInput = z.infer<typeof QrApproveSchema>

// Забор сессии инициировавшим десктопом: qrId + секрет (секрета нет в QR).
export const QrClaimSchema = z
  .object({ qrId: z.string().min(1), claimSecret: z.string().min(1) })
  .strict()
export type QrClaimInput = z.infer<typeof QrClaimSchema>
