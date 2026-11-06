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

/**
 * Ответ обмена refresh — отказ в сессии: cookie истекла, погашена реюз-детектором, подделана
 * или вуз заблокирован. Только тогда сессию бросаем и ведём на /login.
 *
 * Остальное — временное, и сессия жива: 429 значит, что кампус за одним адресом упёрся в
 * лимит (запрос отбит ДО обмена, cookie на сервере не тронута), 5xx и обрыв сети — сбой, а не
 * решение сервера. Раньше любой провал refresh выкидывал человека на вход посреди пары.
 */
export function isSessionRefused(status: number | undefined): boolean {
  return status === 401 || status === 403
}

/** Сколько раз повторить refresh, отбитый лимитом запросов (429). */
export const REFRESH_RATE_LIMIT_RETRIES = 3
const REFRESH_BACKOFF_BASE_MS = 1_000
const REFRESH_BACKOFF_MAX_MS = 15_000

export interface RefreshRetryContext {
  status?: number
  /** Заголовок `Retry-After` (секунды), если браузер дал его прочитать. */
  retryAfter?: string | null
  /** Сколько повторов уже было: 0 — первый провал. */
  attempt: number
  /** Источник случайности для разброса (в тестах — фиксированный). */
  random?: () => number
}

/**
 * Через сколько миллисекунд повторить refresh, или `null` — не повторять.
 *
 * Повторяем только 429: такой запрос отбит лимитом до обработки, одноразовый токен не
 * потрачен, и повтор с той же cookie безопасен. 5xx и сеть не повторяем: неизвестно, дошёл ли
 * обмен до сервера, а повтор уже ротированной cookie сервер принял бы за кражу и погасил
 * сессию целиком.
 *
 * Выдержка растёт вдвое (1, 2, 4 с), `Retry-After` удлиняет её, если сервер просит дольше.
 * Разброс до +50% — чтобы вкладки кампуса, отбитые одновременно, не вернулись тоже разом.
 */
export function refreshRetryDelayMs(ctx: RefreshRetryContext): number | null {
  if (ctx.status !== 429 || ctx.attempt >= REFRESH_RATE_LIMIT_RETRIES) return null
  const backoff = REFRESH_BACKOFF_BASE_MS * 2 ** ctx.attempt
  const hinted = Number(ctx.retryAfter) * 1000
  const base = Number.isFinite(hinted) && hinted > backoff ? hinted : backoff
  const jitter = base * 0.5 * (ctx.random ?? Math.random)()
  return Math.min(base + jitter, REFRESH_BACKOFF_MAX_MS)
}
