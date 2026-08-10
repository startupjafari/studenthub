import { z } from 'zod'

// Схемы аутентификации — единый источник валидации для API (ZodValidationPipe) и форм фронта.

export const LoginSchema = z
  .object({
    email: z.string().email('Некорректный email'),
    password: z.string().min(1, 'Введите пароль'),
  })
  .strict()

export type LoginInput = z.infer<typeof LoginSchema>

// Политика пароля (docs/BACKEND_RULES.md §3): ≥8 символов, буква + цифра + спецсимвол.
export const PasswordSchema = z
  .string()
  .min(8, 'Минимум 8 символов')
  .regex(/[A-Za-zА-Яа-я]/, 'Нужна хотя бы одна буква')
  .regex(/[0-9]/, 'Нужна хотя бы одна цифра')
  .regex(/[^A-Za-zА-Яа-я0-9]/, 'Нужен хотя бы один спецсимвол')

// Регистрация по инвайту (docs/PROJECT.md §7.3): форма принимает только имя, пароль, фото.
// Роль и scope НЕ здесь — они берутся из инвайта на сервере. email — из инвайта либо этой формы.
export const RegisterByInviteSchema = z
  .object({
    token: z.string().min(1),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    password: PasswordSchema,
    email: z.string().email().optional(),
  })
  .strict()

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
