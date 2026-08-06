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
