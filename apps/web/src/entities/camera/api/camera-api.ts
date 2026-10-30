import type {
  CameraListQueryInput,
  CreateCameraAgentInput,
  CreateCameraInput,
  UpdateCameraInput,
} from '@studenthub/shared-schemas'
import { api, getPaged, type Paged } from '../../../shared/api'
import type {
  Camera,
  CameraAdmin,
  CameraAgent,
  CameraAgentWithToken,
  CameraViewTicket,
} from '../model/types'

export const cameraKeys = {
  all: ['cameras'] as const,
  agents: () => ['cameras', 'agents'] as const,
  list: (params: Partial<CameraListQueryInput> = {}) => ['cameras', 'list', params] as const,
  settings: () => ['cameras', 'settings'] as const,
}

export async function fetchCameraAgents(): Promise<CameraAgent[]> {
  const { data } = await api.get<CameraAgent[]>('/camera-agents')
  return data
}

export async function createCameraAgentRequest(
  input: CreateCameraAgentInput,
): Promise<CameraAgentWithToken> {
  const { data } = await api.post<CameraAgentWithToken>('/camera-agents', input)
  return data
}

export async function rotateCameraAgentTokenRequest(id: string): Promise<CameraAgentWithToken> {
  const { data } = await api.post<CameraAgentWithToken>(`/camera-agents/${id}/token`)
  return data
}

export async function deleteCameraAgentRequest(id: string): Promise<void> {
  await api.delete(`/camera-agents/${id}`)
}

/** Сколько камер API отдаёт за страницу — больше схема запроса не пускает. */
const CAMERA_PAGE = 100

/**
 * Все камеры вуза: админу приходит CameraAdmin, охране — Camera. Стена охраны и таблица
 * админа показывают камеры целиком (§3.10: «охрана видит все камеры своего вуза»), а у вуза
 * их может быть до 50 агентов по 200 — поэтому за первой страницей догружаются остальные.
 */
export async function fetchCameras<T extends Camera = Camera>(
  params: Omit<Partial<CameraListQueryInput>, 'page' | 'limit'> = {},
): Promise<Paged<T>> {
  const first = await getPaged<T>('/cameras', { ...params, page: 1, limit: CAMERA_PAGE })
  const pages = Math.ceil(first.total / CAMERA_PAGE)
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
      getPaged<T>('/cameras', { ...params, page: i + 2, limit: CAMERA_PAGE }),
    ),
  )
  // Список могли поменять между страницами — одна камера не должна попасть дважды.
  const byId = new Map<string, T>()
  for (const page of [first, ...rest]) for (const camera of page.items) byId.set(camera.id, camera)
  return { items: [...byId.values()], total: first.total }
}

export async function createCameraRequest(input: CreateCameraInput): Promise<CameraAdmin> {
  const { data } = await api.post<CameraAdmin>('/cameras', input)
  return data
}

export async function updateCameraRequest(
  id: string,
  input: UpdateCameraInput,
): Promise<CameraAdmin> {
  const { data } = await api.patch<CameraAdmin>(`/cameras/${id}`, input)
  return data
}

export async function deleteCameraRequest(id: string): Promise<void> {
  await api.delete(`/cameras/${id}`)
}

export async function fetchCameraSettings(): Promise<{ enabled: boolean }> {
  const { data } = await api.get<{ enabled: boolean }>('/cameras/settings')
  return data
}

export async function updateCameraSettingsRequest(enabled: boolean): Promise<{ enabled: boolean }> {
  const { data } = await api.patch<{ enabled: boolean }>('/cameras/settings', { enabled })
  return data
}

/** Начать просмотр: сессия (запись журнала) и токен ретранслятора. */
export async function startCameraViewRequest(cameraId: string): Promise<CameraViewTicket> {
  const { data } = await api.post<CameraViewTicket>(`/cameras/${cameraId}/views`)
  return data
}

/** Продлить просмотр: свежий токен. 409 — просмотр закрыт (выключили камеры или камеру). */
export async function heartbeatCameraViewRequest(sessionId: string): Promise<CameraViewTicket> {
  const { data } = await api.post<CameraViewTicket>(`/cameras/views/${sessionId}/heartbeat`)
  return data
}

export async function endCameraViewRequest(sessionId: string): Promise<void> {
  await api.post(`/cameras/views/${sessionId}/end`)
}
