import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import type { ApiErrorBody, ApiErrorResponse, ApiMeta } from '@studenthub/shared-types'

// Ответ с сохранённой meta пагинации (см. интерцептор ниже).
export type ResponseWithMeta = AxiosResponse & { meta?: ApiMeta }
import { store } from '../store/store'
import { clearAuth, setAccessToken } from '../store/auth-slice'
import { isRecoverableAuthError, isSessionRefused, refreshRetryDelayMs } from './auth-retry'

// Единственная точка входа для HTTP (docs/FRONTEND_RULES.md §5.1).
export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  withCredentials: true, // refresh-токен в httpOnly cookie
})

// Отдельный «сырой» инстанс для refresh — без интерцепторов, чтобы не зациклиться.
const refreshClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  withCredentials: true,
})

// Access-токен в каждый запрос из памяти (Redux), не из localStorage (§15).
api.interceptors.request.use((config) => {
  const token = store.getState().auth.accessToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Ответа сервера нет (обрыв сети, CORS) — общий вид ошибки для UI.
const NETWORK_ERROR: ApiErrorBody = { code: 'INTERNAL_ERROR', message: 'Ошибка сети' }

// Дедупликация refresh: параллельные 401 ждут один общий промис (§5.3).
//
// Это ЕДИНСТВЕННАЯ точка обмена refresh-токена в приложении — восстановление сессии после
// перезагрузки (shared/session/session.ts) идёт через неё же. Иначе два независимых обмена могут
// уйти одновременно с одной cookie, и сервер расценит второй как повторное использование
// одноразового токена: реюз-детектор гасит всю сессию, а пользователя выбрасывает на /login
// (docs/PROJECT.md §7.2).
let refreshPromise: Promise<string> | null = null

export async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    // Повторы после 429 — внутри общего промиса: ждущие запросы получают один итог.
    refreshPromise = exchangeRefreshToken().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

// Обмен refresh с повтором после 429 (правило выдержки — refreshRetryDelayMs в auth-retry.ts).
async function exchangeRefreshToken(): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await refreshClient.post<{ success: true; data: { accessToken: string } }>(
        '/auth/refresh',
      )
      const token = res.data.data.accessToken
      store.dispatch(setAccessToken(token))
      return token
    } catch (error) {
      const response = (error as AxiosError | undefined)?.response
      const delay = refreshRetryDelayMs({
        status: response?.status,
        retryAfter: readHeader(response?.headers, 'retry-after'),
        attempt,
      })
      if (delay === null) throw error
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

api.interceptors.response.use(
  (response) => {
    const body: unknown = response.data
    if (isEnvelope(body)) {
      response.data = body.data
      // meta (cursor/hasNext/total) кладём рядом — для пагинированных запросов (docs/FRONTEND_RULES.md §5.2).
      ;(response as ResponseWithMeta).meta = (body as { meta?: ApiMeta }).meta
    }
    return response
  },
  async (error: AxiosError<ApiErrorResponse>): Promise<unknown> => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined
    const code = error.response?.data?.error?.code
    // Восстановимый 401 → один refresh (с дедупликацией) и один повтор исходного запроса.
    // Само правило — в auth-retry.ts (там же разбор случаев и почему их именно два).
    if (
      original &&
      isRecoverableAuthError({
        status: error.response?.status,
        code,
        hasBearer: Boolean(original.headers?.Authorization),
        url: original.url,
        alreadyRetried: Boolean(original._retry),
      })
    ) {
      original._retry = true
      let token: string
      try {
        token = await refreshAccessToken()
      } catch (refreshError) {
        const refresh = (refreshError as AxiosError<ApiErrorResponse> | undefined)?.response
        // На вход ведём только по отказу сервера в сессии. 429 (кампус за одним адресом упёрся
        // в лимит и повторы не помогли), 5xx, сеть — сессия жива: запрос падает этой ошибкой,
        // следующий попробует обмен заново.
        if (!isSessionRefused(refresh?.status)) {
          return Promise.reject(refresh?.data?.error ?? NETWORK_ERROR)
        }
        store.dispatch(clearAuth())
        redirectToLogin()
        return Promise.reject(error.response?.data?.error ?? NETWORK_ERROR)
      }
      original.headers.Authorization = `Bearer ${token}`
      return api(original)
    }

    // Привилегированной роли форсим 2FA: любой не-exempt эндпоинт вернул 403 с этим кодом —
    // уводим на экран обязательной настройки 2FA (там дальше только 2fa/refresh эндпоинты).
    if (code === 'TWO_FACTOR_SETUP_REQUIRED') {
      redirectToSetup2fa()
    }

    return Promise.reject(error.response?.data?.error ?? NETWORK_ERROR)
  },
)

function readHeader(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null
  const value = (headers as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : null
}

function isEnvelope(body: unknown): body is { success: true; data: unknown } {
  return typeof body === 'object' && body !== null && 'success' in body && 'data' in body
}

function redirectToLogin(): void {
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.assign('/login')
  }
}

function redirectToSetup2fa(): void {
  if (typeof window !== 'undefined' && window.location.pathname !== '/setup-2fa') {
    window.location.assign('/setup-2fa')
  }
}
