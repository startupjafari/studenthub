// Правило «этот 401 лечится refresh'ем» — вынесено из интерцептора (instance.ts) отдельным чистым
// предикатом: условие тонкое, цена ошибки высокая (лишний повтор логина тратит лимит попыток, а
// пропущенный случай оставляет экран навсегда пустым), а проверять его так можно без мока HTTP.

// Эндпоинты, которые аутентифицируют сами себя — паролем, кодом 2FA, refresh-cookie, инвайтом или
// QR-секретом. Их 401 означает «данные неверны», а не «нет токена»: refresh тут не поможет, а
// повтор запроса второй раз потратит лимит попыток входа (docs/PROJECT.md §7.4).
const SELF_AUTH_PATHS = [
  '/auth/login',
  '/auth/refresh',
  '/auth/register-by-invite',
  '/auth/qr/claim',
]

export interface AuthErrorContext {
  status?: number
  /** Код из тела ответа (`error.code`). */
  code?: string
  /** Ушёл ли запрос с заголовком Authorization. */
  hasBearer: boolean
  /** URL запроса относительно baseURL. */
  url?: string
  /** Этот запрос уже повторяли — второй раз нельзя (защита от цикла). */
  alreadyRetried: boolean
}

/**
 * Стоит ли по этому ответу обновить токен и повторить запрос.
 *
 * Два восстановимых случая:
 *
 * 1. `TOKEN_EXPIRED` — обычное истечение access-токена.
 * 2. `UNAUTHORIZED` у запроса БЕЗ Bearer — холодная загрузка страницы. Access-токен живёт только в
 *    памяти (FRONTEND_RULES §15), а восстанавливает его SessionInitializer в эффекте; запросы
 *    первого рендера успевают уйти раньше и получают именно `UNAUTHORIZED`. Без лечения судьба
 *    экрана зависит от того, обгонит ли единственный повтор React Query восстановление сессии:
 *    не обогнал — виджет остаётся ни с чем (пустой список чатов, «Ошибка сервера» в ленте).
 *
 * `UNAUTHORIZED` при наличии Bearer намеренно НЕ лечим: токен есть, но сервер его отверг (отозван,
 * сессия погашена реюз-детектором) — refresh-cookie в этот момент, как правило, мертва тоже, а
 * лишний цикл лишь маскирует разлогин.
 */
export function isRecoverableAuthError(ctx: AuthErrorContext): boolean {
  if (ctx.status !== 401 || ctx.alreadyRetried) return false
  if (SELF_AUTH_PATHS.some((path) => ctx.url?.includes(path))) return false
  if (ctx.code === 'TOKEN_EXPIRED') return true
  return ctx.code === 'UNAUTHORIZED' && !ctx.hasBearer
}
