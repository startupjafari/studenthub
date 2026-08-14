'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CameraOff, Loader2, ScanLine } from 'lucide-react'

// Нативный BarcodeDetector (Chrome/Edge/Android) — сканируем QR прямо в приложении, без
// внешней зависимости. На браузерах без поддержки (iOS Safari/Firefox) — понятный фолбэк:
// QR всё равно ведёт на /verify-id?t=…, поэтому подходит и обычная камера телефона.
interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike
}
declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorCtor
  }
}

type ScanState = 'starting' | 'scanning' | 'unsupported' | 'denied' | 'error'

// Достаёт токен из содержимого QR: это URL вида `…/verify-id?t=<token>`.
function extractToken(raw: string): string | null {
  try {
    const u = new URL(raw)
    return u.searchParams.get('t')
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
    if (
      typeof window === 'undefined' ||
      !('BarcodeDetector' in window) ||
      !window.BarcodeDetector
    ) {
      setState('unsupported')
      return
    }
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] })

    const cleanup = (): void => {
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((tr) => tr.stop())
    }

    const scan = async (): Promise<void> => {
      const video = videoRef.current
      if (stopped || !video) return
      try {
        const codes = await detector.detect(video)
        const raw = codes[0]?.rawValue
        if (raw) {
          const token = extractToken(raw)
          if (token) {
            stopped = true
            cleanup()
            onTokenRef.current(token)
            return
          }
        }
      } catch {
        /* один кадр не распознан — не критично, пробуем следующий */
      }
      raf = requestAnimationFrame(() => void scan())
    }

    const start = async (): Promise<void> => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })
        if (stopped) {
          stream.getTracks().forEach((tr) => tr.stop())
          return
        }
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        setState('scanning')
        void scan()
      } catch (e) {
        setState((e as Error)?.name === 'NotAllowedError' ? 'denied' : 'error')
      }
    }

    void start()
    return () => {
      stopped = true
      cleanup()
    }
  }, [])

  if (state === 'unsupported' || state === 'denied' || state === 'error') {
    const key =
      state === 'denied' ? 'scanDenied' : state === 'unsupported' ? 'scanUnsupported' : 'scanError'
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
        <div className="relative size-2/3 rounded-2xl">
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
