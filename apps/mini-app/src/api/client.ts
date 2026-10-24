import { webApp } from '../telegram/webapp'

// Обращения к API StudentHub.
//
// Токен живёт ТОЛЬКО в памяти модуля: ни localStorage, ни cookie. Это не осторожность
// ради осторожности — мини-апп открывается во встроенном браузере, который делят все
// мини-аппы клиента, а токен даёт админский доступ к платформе. Закрыли приложение —
// токена не стало.
//
// Refresh-токена нет: истёк — просим новый по тому же initData. Повторяется это ровно
// один раз (иначе 401 от сервера закольцевал бы запросы). Но initData Telegram выдаёт
// один раз при открытии, а сервер принимает его пять минут: позже продлить нечем, и
// оболочка просит переоткрыть мини-апп (`onSessionLost`).

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1'

export interface MiniUser {
  id: string
  firstName: string
  role: 'PLATFORM_ADMIN' | 'PLATFORM_MODERATOR'
}

interface SessionResponse {
  token: string
  expiresIn: number
  user: MiniUser
}

/** Ошибка API с кодом из реестра — интерфейс реагирует на код, а не на текст. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

let token: string | null = null

/** Строка от Telegram. Вне клиента её нет — и это не ошибка сети, а другой сценарий. */
function initData(): string | null {
  const raw = webApp()?.initData
  return raw && raw.length > 0 ? raw : null
}

/** Окно сервера на возраст `auth_date` (INIT_DATA_MAX_AGE_MS в apps/api/src/modules/mini). */
const INIT_DATA_MAX_AGE_MS = 5 * 60_000

/**
 * Протухла ли подпись. Telegram выдаёт initData один раз при открытии и нового не даёт,
 * а сервер принимает его пять минут (docs/PROJECT.md §Мини-апп). Значит, позже пяти минут
 * ни продлить сессию, ни привязаться нельзя — помогает только переоткрыть мини-апп, и
 * сказать это человеку лучше, чем «Telegram не привязан».
 */
export function initDataStale(now: number = Date.now()): boolean {
  const raw = initData()
  if (!raw) return false
  const authDate = Number(new URLSearchParams(raw).get('auth_date'))
  if (!Number.isFinite(authDate) || authDate <= 0) return false
  return now - authDate * 1000 > INIT_DATA_MAX_AGE_MS
}

let sessionLost: (() => void) | null = null

/**
 * Подписка на потерю сессии: токен истёк, а продлить его нечем. Оболочка показывает экран
 * «переоткройте» — экраны по отдельности знали бы только, что их запрос не удался.
 */
export function onSessionLost(listener: (() => void) | null): void {
  sessionLost = listener
}

/**
 * Обменивает initData на токен. Вызывается при старте и повторно, когда токен истёк.
 *
 * Отказ здесь означает ровно одно: этот Telegram не связан с допущенным аккаунтом. Какая
 * именно причина — не привязан, отозван, сменилась роль — сервер намеренно не сообщает
 * (docs/PROJECT.md §Мини-апп), поэтому и интерфейс не пытается угадывать.
 */
export async function openSession(): Promise<MiniUser> {
  const data = initData()
  if (!data) throw new ApiError('NO_TELEGRAM', 'Приложение открыто вне Telegram', 0)

  const session = await post<SessionResponse>('/mini/session', { initData: data }, false)
  token = session.token
  return session.user
}

/** Привязка по коду из веба. При успехе сразу выдаётся сессия — второй запрос не нужен. */
export async function linkAccount(code: string): Promise<MiniUser> {
  const data = initData()
  if (!data) throw new ApiError('NO_TELEGRAM', 'Приложение открыто вне Telegram', 0)
  // За кодом ходят в веб, и это бывает дольше пяти минут: сервер ответил бы тем же
  // «нет доступа», что и чужому аккаунту, и человек решил бы, что его не допустили.
  if (initDataStale()) throw new ApiError('INIT_DATA_STALE', 'Подпись Telegram устарела', 0)

  const session = await post<SessionResponse>('/mini/link', { initData: data, code }, false)
  token = session.token
  return session.user
}

export async function apiGet<T>(path: string): Promise<T> {
  return (await request<T>('GET', path)).data
}

/**
 * Страничный ответ: рядом с данными едет `meta` с общим количеством. Отдельный помощник,
 * потому что обычный `apiGet` разворачивает `data` и `meta` при этом теряется — а размер
 * очереди нужен экрану не меньше первых тридцати строк.
 */
export async function apiGetPaged<T>(path: string): Promise<{ items: T[]; total: number }> {
  const { data, meta } = await request<T[]>('GET', path)
  const items = data ?? []
  return { items, total: meta?.total ?? items.length }
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return (await request<T>('PATCH', path, body)).data
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return (await request<T>('POST', path, body)).data
}

/**
 * Загрузка файла. Отдельно от `request`: у multipart нельзя ставить `content-type` руками —
 * его формирует браузер вместе с границей частей, и наш заголовок сломал бы разбор.
 * Повтор после истечения токена тот же, но тело переиспользуемое: FormData читается один
 * раз только у потоков, а этот объект можно отправить снова.
 */
export async function apiUpload<T>(path: string, form: FormData, retry = true): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  })

  if (response.status === 401 && retry && token) {
    const failure = await toApiError(response)
    if (!isExpiredToken(failure)) throw failure
    await renewSession()
    return apiUpload<T>(path, form, false)
  }

  return (await unwrap<T>(response)).data
}

interface Envelope<T> {
  data: T
  meta?: { total?: number }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retry = true,
): Promise<Envelope<T>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  if (response.status === 401 && retry && token) {
    // 401 — не всегда истёкший токен: неверный код 2FA (`INVALID_2FA_CODE`) приходит тем
    // же статусом. Продлевать сессию на нём значило бы отправить код второй раз (и съесть
    // лимит попыток), а через пять минут после открытия — потерять сессию из-за опечатки.
    const failure = await toApiError(response)
    if (!isExpiredToken(failure)) throw failure
    // Пятнадцать минут истекли — берём новый токен и повторяем ОДИН раз.
    await renewSession()
    return request<T>(method, path, body, false)
  }

  return unwrap<T>(response)
}

/** Сессию продлеваем только на отказе в самом токене (§8.2): реагируем на `code`. */
function isExpiredToken(error: ApiError): boolean {
  return error.code === 'TOKEN_EXPIRED' || error.code === 'UNAUTHORIZED'
}

async function renewSession(): Promise<void> {
  token = null
  if (initDataStale()) {
    sessionLost?.()
    throw new ApiError('SESSION_EXPIRED', 'Сессия истекла — переоткройте мини-апп', 401)
  }
  try {
    await openSession()
  } catch (cause) {
    // Отказ сервера (а не сети) — продлить нечем: привязку сняли или роль сменилась.
    if (cause instanceof ApiError && cause.status === 401) sessionLost?.()
    throw cause
  }
}

async function post<T>(path: string, body: unknown, retry = true): Promise<T> {
  return (await request<T>('POST', path, body, retry)).data
}

/**
 * Бэкенд отвечает `{ success, data }` при успехе и `{ error: { code, message } }` при
 * отказе. Разворачиваем здесь, чтобы экраны работали с чистыми сущностями.
 */
async function unwrap<T>(response: Response): Promise<Envelope<T>> {
  if (!response.ok) throw await toApiError(response)

  const payload = await readJson(response)
  const envelope = payload as { data?: T; meta?: { total?: number } } | null
  return {
    data: (envelope?.data ?? payload) as T,
    ...(envelope?.meta ? { meta: envelope.meta } : {}),
  }
}

/** Отказ сервера → `ApiError` с кодом из `{ error: { code, message } }`. */
async function toApiError(response: Response): Promise<ApiError> {
  const payload = await readJson(response)
  const error = (payload as { error?: { code?: string; message?: string } } | null)?.error
  return new ApiError(
    error?.code ?? `HTTP_${response.status}`,
    error?.message ?? 'Запрос не удался',
    response.status,
  )
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    // Пустое тело или не-JSON: отказ превратится в ошибку с кодом по статусу.
    return null
  }
}
