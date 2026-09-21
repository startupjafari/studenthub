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
 * Тепловая карта 7×24 тоже здесь: на ладони она читается только как силуэт — где темно,
 * там людей нет, — и ровно на этот вопрос («когда платформу можно останавливать») её и
 * смотрят с телефона. Цифры по часам остаются в вебе.
 */
export async function fetchInvitesFunnel(): Promise<InvitesFunnel> {
  return apiGet<InvitesFunnel>('/analytics/platform/invites-funnel')
}

export async function fetchUniversitySizes(): Promise<UniversitySize[]> {
  const page = await apiGet<{ items?: UniversitySize[] }>('/analytics/platform/universities-size')
  return page.items ?? []
}

export interface QueueCount {
  name: string
  waiting: number
  failed: number
}

/** Размеры очередей: растущее «ждёт» — воркер не справляется, «упало» — работа потеряна. */
export async function fetchQueues(): Promise<QueueCount[]> {
  return apiGet<QueueCount[]>('/platform/queues')
}

export interface StorageUsage {
  files: number
  bytes: number
}

export interface PlatformChange {
  action: string
  at: string
  by: { id: string; firstName: string; lastName: string } | null
}

/** Объём наших файлов по журналу. Свободное место S3-хранилище не сообщает. */
export async function fetchStorage(): Promise<StorageUsage> {
  return apiGet<StorageUsage>('/platform/storage')
}

/** Кто двигал рычаги. Публичное состояние этого не отдаёт — посетителю знать незачем. */
export async function fetchChanges(): Promise<PlatformChange[]> {
  return apiGet<PlatformChange[]>('/platform/changes')
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

/**
 * Активность по дням недели и часам. `cells[dow][hour]` — события журнала, `max` — самая
 * горячая клетка: по ней и красится сетка, иначе в тихую неделю карта была бы пустой.
 * Зона считается на сервере; спрашиваем ту, в которой живёт телефон.
 */
export interface ActivityGrid {
  cells: number[][]
  max: number
  tz: string
}

export async function fetchActivity(): Promise<ActivityGrid> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const params = tz ? `?tz=${encodeURIComponent(tz)}` : ''
  return apiGet<ActivityGrid>(`/analytics/platform/activity-heatmap${params}`)
}
