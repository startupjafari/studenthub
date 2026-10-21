'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  endCameraViewRequest,
  heartbeatCameraViewRequest,
  startCameraViewRequest,
  type CameraViewBlock,
  type CameraViewTicket,
} from '../../../entities/camera'

export type CameraViewStatus =
  | { kind: 'starting' }
  | { kind: 'active'; ticket: CameraViewTicket }
  | { kind: 'blocked'; reason: CameraViewBlock }
  | { kind: 'error'; code: string }

function blockReason(error: unknown): CameraViewBlock | null {
  const e = error as { code?: string; details?: { field?: string }[] }
  if (e.code !== 'CONFLICT') return null
  const field = e.details?.[0]?.field
  return field === 'relay' || field === 'module' || field === 'camera' || field === 'views'
    ? field
    : null
}

/**
 * Сессия просмотра камеры (docs/PROJECT.md §3.10): начать при монтировании, продлевать по
 * таймеру, закончить при размонтировании. Продление не прошло (выключили камеры) — плеер
 * гаснет сразу, не дожидаясь, пока истечёт токен.
 */
export function useCameraView(cameraId: string): {
  status: CameraViewStatus
  getToken: () => string
} {
  const [status, setStatus] = useState<CameraViewStatus>({ kind: 'starting' })
  const tokenRef = useRef('')
  const getToken = useCallback(() => tokenRef.current, [])

  useEffect(() => {
    let cancelled = false
    let sessionId: string | null = null
    let timer: ReturnType<typeof setInterval> | null = null

    const fail = (error: unknown): void => {
      if (cancelled) return
      if (timer) clearInterval(timer)
      const reason = blockReason(error)
      setStatus(
        reason
          ? { kind: 'blocked', reason }
          : { kind: 'error', code: (error as { code?: string }).code ?? 'INTERNAL_ERROR' },
      )
    }

    startCameraViewRequest(cameraId)
      .then((ticket) => {
        if (cancelled) {
          void endCameraViewRequest(ticket.sessionId).catch(() => undefined)
          return
        }
        sessionId = ticket.sessionId
        tokenRef.current = ticket.token
        setStatus({ kind: 'active', ticket })
        timer = setInterval(() => {
          heartbeatCameraViewRequest(ticket.sessionId)
            .then((next) => {
              tokenRef.current = next.token
            })
            .catch(fail)
        }, ticket.heartbeatInSec * 1000)
      })
      .catch(fail)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      // Закрыть сессию сразу: последний зритель ушёл — агент гасит поток за секунду. Не
      // дошло (закрыли вкладку) — сессия истечёт сама.
      if (sessionId) void endCameraViewRequest(sessionId).catch(() => undefined)
    }
  }, [cameraId])

  return { status, getToken }
}
