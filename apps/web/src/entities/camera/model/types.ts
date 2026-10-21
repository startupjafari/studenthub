import type { CameraStatusValue } from '@studenthub/shared-schemas'

// Камеры вуза — зеркало ответов API (docs/PROJECT.md §3.10).

export type AgentConnection = 'NEVER' | 'ONLINE' | 'OFFLINE'

export interface CameraAgent {
  id: string
  name: string
  connection: AgentConnection
  /** Агент прислал открытый ключ — камерам с паролем есть чем его зашифровать. */
  ready: boolean
  version: string | null
  lastSeenAt: string | null
  createdAt: string
  cameraCount: number
}

/** Камера глазами охраны: без адреса потока и агента. */
export interface Camera {
  id: string
  name: string
  room: { id: string; name: string } | null
  enabled: boolean
  status: CameraStatusValue
  lastSeenAt: string | null
}

/** Камера глазами админа вуза. Пароль не приходит никогда — только признак, что он задан. */
export interface CameraAdmin extends Camera {
  agent: { id: string; name: string }
  streamUrl: string
  hasCredentials: boolean
  createdAt: string
}

/**
 * Пропуск на просмотр камеры: адрес LL-HLS ретранслятора и токен к нему. Токен живёт
 * `expiresInSec`, продлевать — каждые `heartbeatInSec`.
 */
export interface CameraViewTicket {
  sessionId: string
  cameraId: string
  hlsUrl: string
  token: string
  expiresInSec: number
  heartbeatInSec: number
}

/** Почему просмотр не начался или закрылся (`details.field` у `409`). */
export type CameraViewBlock = 'relay' | 'module' | 'camera' | 'views'

/** Агент с токеном — ответ создания и перевыпуска. Токен показывается один раз. */
export interface CameraAgentWithToken {
  agent: CameraAgent
  token: string
}
