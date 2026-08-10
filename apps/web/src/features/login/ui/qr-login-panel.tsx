'use client'

import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useTranslations } from 'next-intl'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '../../../shared/ui'
import { qrCreateRequest, qrClaimRequest, type QrCreateResponse } from '../../../shared/api'

// Origin WS-сервера: NEXT_PUBLIC_WS_URL или выводим из NEXT_PUBLIC_API_URL (dev).
function wsOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_WS_URL
  if (explicit) return explicit
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'
  try {
    const u = new URL(apiUrl)
    return `${u.protocol}//${u.host}`
  } catch {
    return 'http://localhost:3001'
  }
}

// Панель входа по QR (десктоп): создаёт QR-сессию, слушает подтверждение по WS
// (namespace /qr-login, без токена) и по событию qr:approved забирает сессию.
export function QrLoginPanel({
  onAuthenticated,
  onCancel,
}: {
  onAuthenticated: (accessToken: string) => Promise<void>
  onCancel: () => void
}) {
  const t = useTranslations('Auth')
  const [session, setSession] = useState<QrCreateResponse | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'expired' | 'error'>('loading')
  const socketRef = useRef<Socket | null>(null)
  const expiryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function start() {
    setStatus('loading')
    try {
      const s = await qrCreateRequest()
      setSession(s)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }

  // Создаём QR-сессию один раз при монтировании (и по «обновить» через кнопку).
  useEffect(() => {
    void start()
    return () => {
      socketRef.current?.disconnect()
      socketRef.current = null
      if (expiryRef.current) clearTimeout(expiryRef.current)
    }
  }, [])

  // На каждую новую сессию — сокет + подписка + таймер истечения.
  useEffect(() => {
    if (!session) return
    const socket = io(`${wsOrigin()}/qr-login`, { transports: ['websocket'] })
    socketRef.current = socket
    socket.on('connect', () => socket.emit('qr:subscribe', { qrId: session.qrId }))
    socket.on('qr:approved', () => {
      void (async () => {
        try {
          const token = await qrClaimRequest(session.qrId, session.claimSecret)
          await onAuthenticated(token)
        } catch {
          setStatus('error')
        }
      })()
    })
    expiryRef.current = setTimeout(() => setStatus('expired'), session.expiresIn * 1000)
    return () => {
      socket.disconnect()
      if (expiryRef.current) clearTimeout(expiryRef.current)
    }
  }, [session])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">{t('qrTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('qrHint')}</p>
      </div>

      <div className="flex flex-col items-center gap-4">
        <div className="relative flex size-56 items-center justify-center rounded-2xl border border-border bg-white p-3">
          {status === 'ready' && session ? (
            // Data-URL от бэкенда — обычный img.
            <img src={session.qr} alt={t('qrTitle')} className="size-full" />
          ) : status === 'expired' || status === 'error' ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="px-3 text-sm text-muted-foreground">
                {status === 'expired' ? t('qrExpired') : t('qrError')}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void start()}>
                <RefreshCw className="size-4" aria-hidden />
                {t('qrRefresh')}
              </Button>
            </div>
          ) : (
            <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
          )}
        </div>
        {status === 'ready' && (
          <p className="text-center text-xs text-muted-foreground">{t('qrWaiting')}</p>
        )}
      </div>

      <button
        type="button"
        onClick={onCancel}
        className="cursor-pointer rounded text-sm font-medium text-muted-foreground underline-offset-4 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        {t('qrBackToPassword')}
      </button>
    </div>
  )
}
