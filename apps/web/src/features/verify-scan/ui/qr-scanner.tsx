'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CameraOff, Loader2 } from 'lucide-react'
import QrScannerLib from 'qr-scanner'

// Кросс-браузерное сканирование QR в приложении: библиотека qr-scanner сама управляет камерой
// (getUserMedia), декодирует в воркере и корректно работает в Safari/iOS и Chrome (в отличие от
// нативного BarcodeDetector, которого в Safari/Firefox нет). Компонент грузится лениво
// (next/dynamic в verify-id-view), поэтому библиотека не попадает в бандлы других экранов.
//
// Визуально — иммерсивный тёмный экран в стиле Kaspi/Telegram: полноэкранное видео камеры,
// затемнение вокруг центрального окна (box-shadow spread), оранжевые уголки и бегущая линия.
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

// Углы рамки наведения (оранжевые скобки по углам окна сканирования).
const CORNERS = [
  'left-0 top-0 border-l-4 border-t-4 rounded-tl-2xl',
  'right-0 top-0 border-r-4 border-t-4 rounded-tr-2xl',
  'left-0 bottom-0 border-l-4 border-b-4 rounded-bl-2xl',
  'right-0 bottom-0 border-r-4 border-b-4 rounded-br-2xl',
]

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
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-3xl bg-neutral-950 p-8 text-center">
        <CameraOff className="size-10 text-white/60" aria-hidden />
        <p className="text-sm font-medium text-white">{t(key)}</p>
        <p className="max-w-xs text-xs text-white/50">{t(`${key}Hint`)}</p>
      </div>
    )
  }

  // Занимает всю доступную область: `flex-1` вместо фиксированных 70vh — на телефоне
  // это экран целиком, на десктопе вся высота контента под шапкой.
  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col items-center overflow-hidden rounded-3xl bg-black">
      {/* Полноэкранное видео камеры под затемнением. */}
      <video
        ref={videoRef}
        className="absolute inset-0 size-full object-cover"
        muted
        playsInline
        aria-label={t('scanTitle')}
      />

      {/* Заголовок сверху (Kaspi-стиль: «Сканируйте QR-код»). */}
      <p className="relative z-20 mt-10 px-6 text-center text-lg font-semibold text-white drop-shadow">
        {t('scanTitle')}
      </p>

      {/* Центральное окно сканирования: затемняем всё вокруг через box-shadow spread. */}
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
        <div
          // Рамка растёт вместе с областью, но не выше её: потолок задан в vh, иначе
          // на широком экране квадрат вылезал бы за нижний край.
          className="relative aspect-square w-[68%] max-w-[min(60vh,560px)] overflow-hidden rounded-2xl"
          style={
            {
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6)',
              '--sh-scan-range': '240px',
            } as React.CSSProperties
          }
        >
          {/* Оранжевые уголки рамки. */}
          {CORNERS.map((pos, i) => (
            <span key={i} className={`absolute size-9 border-[#ff6a2b] ${pos}`} aria-hidden />
          ))}
          {/* Бегущая сканирующая линия. */}
          {state === 'scanning' && (
            <span
              className="sh-scanline absolute inset-x-3 top-0 h-0.5 rounded-full bg-[#ff6a2b] shadow-[0_0_12px_#ff6a2b]"
              aria-hidden
            />
          )}
        </div>
      </div>

      {/* Подсказка снизу. */}
      <p className="relative z-20 mb-10 mt-auto px-6 text-center text-sm text-white/70">
        {t('scanHint')}
      </p>

      {/* Запуск камеры. */}
      {state === 'starting' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-black/70 text-white">
          <Loader2 className="size-8 animate-spin" aria-hidden />
          <p className="text-sm">{t('scanStarting')}</p>
        </div>
      )}
    </div>
  )
}
