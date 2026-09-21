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

export async function fetchOverview(): Promise<PlatformOverview> {
  return apiGet<PlatformOverview>('/analytics/platform/overview')
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
