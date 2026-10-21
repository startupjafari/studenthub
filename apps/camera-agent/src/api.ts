// Клиент платформы: единственный вызов — длинный опрос POST /camera-agent/sync.
// Типы протокола повторяют @studenthub/shared-schemas (CameraAgentSync*): агент собирается
// отдельно от монорепо, и зависеть от пакетов платформы ему незачем.

export type CameraStatus = 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'

export interface SyncRequest {
  version: string
  publicKey: string
  revision?: string
  cameras: { id: string; status: CameraStatus }[]
}

export interface CameraConfig {
  id: string
  streamUrl: string
  credentialsSealed: string | null
}

export interface SyncResponse {
  revision: string
  enabled: boolean
  cameras: CameraConfig[]
}

/** Ошибка платформы с её кодом (`UNAUTHORIZED`, `CONFLICT`…) и полями деталей. */
export class PlatformError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: string[] = [],
  ) {
    super(message)
  }

  /** Токен отозван или неверен — повторять часто бессмысленно. */
  get unauthorized(): boolean {
    return this.status === 401
  }

  /** Платформа знает другой ключ агента — нужен перевыпуск токена. */
  get keyMismatch(): boolean {
    return this.status === 409 && this.fields.includes('publicKey')
  }
}

// Опрос держится на сервере до 25 с; запас на сеть и медленный ответ.
const REQUEST_TIMEOUT_MS = 40_000

export async function sync(
  apiUrl: string,
  token: string,
  body: SyncRequest,
): Promise<SyncResponse> {
  const res = await fetch(`${apiUrl}/camera-agent/sync`, {
    method: 'POST',
    headers: { authorization: `Agent ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const payload = (await res.json().catch(() => null)) as
    | { success: true; data: SyncResponse }
    | {
        success: false
        error?: { code?: string; message?: string; details?: { field?: string }[] }
      }
    | null
  if (res.ok && payload && payload.success) return payload.data
  const error = payload && !payload.success ? payload.error : undefined
  throw new PlatformError(
    res.status,
    error?.code ?? 'HTTP_ERROR',
    error?.message ?? `Платформа ответила ${res.status}`,
    (error?.details ?? []).map((d) => d.field ?? '').filter(Boolean),
  )
}
