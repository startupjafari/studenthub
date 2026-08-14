'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CameraOff, Loader2, ScanLine } from 'lucide-react'
import QrScannerLib from 'qr-scanner'

// Кросс-браузерное сканирование QR в приложении: библиотека qr-scanner сама управляет камерой
// (getUserMedia), декодирует в воркере и корректно работает в Safari/iOS и Chrome (в отличие от
// нативного BarcodeDetector, которого в Safari/Firefox нет). Компонент грузится лениво
// (next/dynamic в verify-id-view), поэтому библиотека не попадает в бандлы других экранов.
type ScanState = 'starting' | 'scanning' | 'denied' | 'error'

// Достаёт токен из содержимого QR: это URL вида `…/verify-id?t=<token>`.
function extractToken(raw: string): string | null {
  try {
    return new URL(raw).searchParams.get('t')
  } catch {
    const q = raw.split('?')[1]
    return q ? new URLSearchParams(q).get('t') : null
  }
}

export function QrScanner({ onToken }: { onToken: (token: string) => void }) {
  const t = useTranslations('StudentId')
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<ScanState>('starting')

  // onToken держим в ref, чтобы эффект камеры не перезапускался из-за смены ссылки колбэка.
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let stopped = false

    const scanner = new QrScannerLib(
      video,
      (result) => {
        if (stopped) return
        const token = extractToken(result.data)
        if (token) {
          stopped = true
          scanner.stop()
          onTokenRef.current(token)
        }
      },
      {
        preferredCamera: 'environment',
        maxScansPerSecond: 5,
        highlightScanRegion: false,
        highlightCodeOutline: false,
        returnDetailedScanResult: true,
      },
    )

    scanner
      .start()
      .then(() => {
        if (!stopped) setState('scanning')
      })
      .catch((e: unknown) => {
        const msg = (e instanceof Error ? `${e.name} ${e.message}` : String(e)).toLowerCase()
        const denied = msg.includes('allow') || msg.includes('permission') || msg.includes('denied')
        setState(denied ? 'denied' : 'error')
      })

    return () => {
      stopped = true
      scanner.stop()
      scanner.destroy()
    }
  }, [])

  if (state === 'denied' || state === 'error') {
    const key = state === 'denied' ? 'scanDenied' : 'scanError'
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-muted/30 p-8 text-center">
        <CameraOff className="size-9 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">{t(key)}</p>
        <p className="text-xs text-muted-foreground">{t(`${key}Hint`)}</p>
      </div>
    )
  }

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-border bg-black">
      <video
        ref={videoRef}
        className="size-full object-cover"
        muted
        playsInline
        aria-label={t('scanTitle')}
      />
      {/* Рамка наведения. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="relative size-2/3">
          {['left-0 top-0', 'right-0 top-0', 'left-0 bottom-0', 'right-0 bottom-0'].map(
            (pos, i) => (
              <span
                key={i}
                className={`absolute size-8 border-primary ${pos} ${i < 2 ? 'border-t-4' : 'border-b-4'} ${i % 2 === 0 ? 'border-l-4' : 'border-r-4'} rounded-[10px]`}
              />
            ),
          )}
        </div>
      </div>
      {state === 'starting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-white">
          <Loader2 className="size-8 animate-spin" aria-hidden />
          <p className="text-sm">{t('scanStarting')}</p>
        </div>
      )}
      {state === 'scanning' && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent p-3 text-xs text-white">
          <ScanLine className="size-4" aria-hidden />
          {t('scanHint')}
        </div>
      )}
    </div>
  )
}
