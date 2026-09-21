import { apiGet } from './client'

// Сводка платформы и живость сервисов — ответ на вопрос «всё ли в порядке», который
// задают с телефона. Графики и разрезы остаются в вебе: их читают за столом.

export interface PlatformOverview {
  universities: { active: number; pending: number; blocked: number }
  users: { total: number; spark: number[] }
  complaints: { pending: number; spark: number[] }
  activeUsers: { dau: number; wau: number; spark: number[] }
}

export type HealthStatus = 'ok' | 'error'

export interface HealthReport {
  database: HealthStatus
  redis: HealthStatus
  minio: HealthStatus
}

export interface InvitesFunnel {
  total: number
  used: number
  /** Доля использованных, проценты. */
  conversion: number
}

export interface UniversitySize {
  id: string
  name: string
  students: number
  teachers: number
  total: number
}

export interface TopAction {
  action: string
  value: number
}

export async function fetchOverview(): Promise<PlatformOverview> {
  return apiGet<PlatformOverview>('/analytics/platform/overview')
}

/**
 * Дополнительные разрезы. Тянутся отдельно и по отказу молчат: сводка обязана
 * показаться, даже если один из агрегатов не посчитался.
 *
 * Тепловой карты активности 7×24 здесь нет намеренно, хотя ручка существует: на экране
 * шириной с ладонь она превращается в картинку, по которой ничего не решить.
 */
export async function fetchInvitesFunnel(): Promise<InvitesFunnel> {
  return apiGet<InvitesFunnel>('/analytics/platform/invites-funnel')
}

export async function fetchUniversitySizes(): Promise<UniversitySize[]> {
  const page = await apiGet<{ items?: UniversitySize[] }>('/analytics/platform/universities-size')
  return page.items ?? []
}

export async function fetchTopActions(): Promise<TopAction[]> {
  const page = await apiGet<{ items?: TopAction[] }>('/analytics/platform/top-actions')
  return page.items ?? []
}

/**
 * Живость зависимостей. Эндпоинт публичный и при беде отвечает 503 — поэтому читаем его
 * в обход общего клиента: там 503 стало бы исключением, а здесь «не отвечает» и есть
 * ответ, ради которого экран существует.
 */
export async function fetchHealth(): Promise<HealthReport> {
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1'
  const response = await fetch(`${base}/health`)
  const payload = (await response.json().catch(() => null)) as {
    info?: Record<string, { status?: string }>
    error?: Record<string, { status?: string }>
  } | null

  const read = (key: string): HealthStatus => {
    const state = payload?.info?.[key]?.status ?? payload?.error?.[key]?.status
    return state === 'up' ? 'ok' : 'error'
  }

  return { database: read('database'), redis: read('redis'), minio: read('minio') }
}
