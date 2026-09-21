import { webApp } from '../telegram/webapp'

// Обращения к API StudentHub.
//
// Токен живёт ТОЛЬКО в памяти модуля: ни localStorage, ни cookie. Это не осторожность
// ради осторожности — мини-апп открывается во встроенном браузере, который делят все
// мини-аппы клиента, а токен даёт админский доступ к платформе. Закрыли приложение —
// токена не стало.
//
// Refresh-токена нет: истёк — просим новый по свежему initData, он у клиента всегда под
// рукой. Поэтому «протух токен» здесь не ошибка, а обычный шаг, и повторяется он ровно
// один раз (иначе 401 от сервера закольцевал бы запросы).

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
    // Пятнадцать минут истекли — берём новый токен и повторяем ОДИН раз.
    token = null
    await openSession()
    return request<T>(method, path, body, false)
  }

  return unwrap<T>(response)
}

async function post<T>(path: string, body: unknown, retry = true): Promise<T> {
  return (await request<T>('POST', path, body, retry)).data
}

/**
 * Бэкенд отвечает `{ success, data }` при успехе и `{ error: { code, message } }` при
 * отказе. Разворачиваем здесь, чтобы экраны работали с чистыми сущностями.
 */
async function unwrap<T>(response: Response): Promise<Envelope<T>> {
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    // Пустое тело или не-JSON: ниже превратится в ошибку с кодом по статусу.
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error
    throw new ApiError(
      error?.code ?? `HTTP_${response.status}`,
      error?.message ?? 'Запрос не удался',
      response.status,
    )
  }

  const envelope = payload as { data?: T; meta?: { total?: number } } | null
  return {
    data: (envelope?.data ?? payload) as T,
    ...(envelope?.meta ? { meta: envelope.meta } : {}),
  }
}
