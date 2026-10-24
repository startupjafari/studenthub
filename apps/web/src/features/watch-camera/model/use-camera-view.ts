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

// Продление не прошло из-за сети или сбоя сервера — повтор через несколько секунд, а не через
// полный интервал: токен живёт две минуты, и окно не должно гаснуть от одного сбоя.
const RETRY_MS = 5_000

/** Отказ, который повтор не исправит: нет прав на камеры. */
const PERMANENT = new Set(['FORBIDDEN', 'WRONG_SCOPE', 'UNAUTHORIZED'])

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
 * таймеру, закончить при размонтировании. Продление отказано (выключили камеры или камеру)
 * — плеер гаснет сразу, не дожидаясь, пока истечёт токен. Сбой сети или сервера — повтор
 * через несколько секунд; сессия истекла, пока продления не доходили, — начинается новая.
 * Видео не пошло насовсем — плеер зовёт `release`: сессия закрывается, продления
 * прекращаются, агент гасит поток, а слот из четырёх одновременных просмотров освобождается.
 */
export function useCameraView(cameraId: string): {
  status: CameraViewStatus
  getToken: () => string
  release: () => void
} {
  const [status, setStatus] = useState<CameraViewStatus>({ kind: 'starting' })
  const tokenRef = useRef('')
  const releaseRef = useRef<() => void>(() => undefined)
  const getToken = useCallback(() => tokenRef.current, [])
  const release = useCallback(() => releaseRef.current(), [])

  useEffect(() => {
    let cancelled = false
    let sessionId: string | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (): void => {
      if (timer) clearTimeout(timer)
      timer = null
      // Закрыть сессию сразу: последний зритель ушёл — агент гасит поток за секунду. Не
      // дошло (закрыли вкладку) — сессия истечёт сама.
      if (sessionId) void endCameraViewRequest(sessionId).catch(() => undefined)
      sessionId = null
    }
    releaseRef.current = finish

    const fail = (error: unknown): void => {
      if (cancelled) return
      if (timer) clearTimeout(timer)
      const reason = blockReason(error)
      setStatus(
        reason
          ? { kind: 'blocked', reason }
          : { kind: 'error', code: (error as { code?: string }).code ?? 'INTERNAL_ERROR' },
      )
    }

    const schedule = (ms: number): void => {
      if (!cancelled) timer = setTimeout(beat, ms)
    }

    function beat(): void {
      if (!sessionId) return
      heartbeatCameraViewRequest(sessionId)
        .then((next) => {
          // Отменили или отпустили сессию, пока продление шло, — больше не продлеваем.
          if (cancelled || !sessionId) return
          tokenRef.current = next.token
          schedule(next.heartbeatInSec * 1000)
        })
        .catch((error: unknown) => {
          if (cancelled || !sessionId) return
          const code = (error as { code?: string }).code ?? ''
          if (blockReason(error) || PERMANENT.has(code)) fail(error)
          // Сессия истекла или закрыта, пока продления не доходили, — открыть новую.
          else if (code === 'NOT_FOUND') begin()
          else schedule(RETRY_MS)
        })
    }

    function begin(): void {
      startCameraViewRequest(cameraId)
        .then((ticket) => {
          if (cancelled) {
            void endCameraViewRequest(ticket.sessionId).catch(() => undefined)
            return
          }
          sessionId = ticket.sessionId
          tokenRef.current = ticket.token
          setStatus({ kind: 'active', ticket })
          schedule(ticket.heartbeatInSec * 1000)
        })
        .catch(fail)
    }

    begin()

    return () => {
      cancelled = true
      releaseRef.current = () => undefined
      finish()
    }
  }, [cameraId])

  return { status, getToken, release }
}
