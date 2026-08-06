// Имена cookie и хелперы сроков для auth.

// httpOnly refresh-cookie (docs/BACKEND_RULES.md §6.2).
export const REFRESH_COOKIE = 'sh_refresh'
// Нечувствительная cookie с ролью+scope для ролевого редиректа в middleware.ts фронта
// (решение §16.2). НЕ httpOnly, читается клиентом. Не является защитой — только UX.
export const ROLE_COOKIE = 'sh_role'

// Путь, на который браузер шлёт refresh-cookie (только auth-эндпоинты).
export const AUTH_COOKIE_PATH = '/api/v1/auth'

/** Парсит строку срока вида '15m' | '30d' | '12h' | '45s' в миллисекунды. */
export function parseDurationMs(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim())
  if (!match) {
    throw new Error(`Некорректный формат срока: ${value}`)
  }
  const amount = Number(match[1])
  const unit = match[2]
  const factor = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000
  return amount * factor
}
