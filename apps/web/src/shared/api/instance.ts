import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import type { ApiErrorBody, ApiErrorResponse, ApiMeta } from '@studenthub/shared-types'

// Ответ с сохранённой meta пагинации (см. интерцептор ниже).
export type ResponseWithMeta = AxiosResponse & { meta?: ApiMeta }
import { store } from '../store/store'
import { clearAuth, setAccessToken } from '../store/auth-slice'

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

// Дедупликация refresh: параллельные 401 ждут один общий промис (§5.3).
let refreshPromise: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = refreshClient
      .post<{ success: true; data: { accessToken: string } }>('/auth/refresh')
      .then((res) => {
        const token = res.data.data.accessToken
        store.dispatch(setAccessToken(token))
        return token
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
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
    const isRefreshCall = original?.url?.includes('/auth/refresh')

    // 401 TOKEN_EXPIRED → один refresh (с дедупликацией) и один повтор исходного запроса.
    if (
      error.response?.status === 401 &&
      code === 'TOKEN_EXPIRED' &&
      original &&
      !original._retry &&
      !isRefreshCall
    ) {
      original._retry = true
      try {
        const token = await refreshAccessToken()
        original.headers.Authorization = `Bearer ${token}`
        return api(original)
      } catch {
        store.dispatch(clearAuth())
        redirectToLogin()
      }
    }

    // Привилегированной роли форсим 2FA: любой не-exempt эндпоинт вернул 403 с этим кодом —
    // уводим на экран обязательной настройки 2FA (там дальше только 2fa/refresh эндпоинты).
    if (code === 'TWO_FACTOR_SETUP_REQUIRED') {
      redirectToSetup2fa()
    }

    const fallback: ApiErrorBody = { code: 'INTERNAL_ERROR', message: 'Ошибка сети' }
    return Promise.reject(error.response?.data?.error ?? fallback)
  },
)

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
