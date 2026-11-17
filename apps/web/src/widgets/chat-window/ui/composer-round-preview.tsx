'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { ROUND_VIDEO_MAX_SECONDS } from '../../../entities/chat'

const RING_R = 48
const RING_C = 2 * Math.PI * RING_R

/**
 * Круглое превью камеры, пока пишется кружок (Telegram): над полем ввода, по центру ленты,
 * зеркально — как в селфи-камере, — и с кольцом, которое заполняется к потолку длины.
 *
 * Звука в превью нет: человек не должен слышать себя с задержкой. Кольцо идёт по секундам
 * рекордера с переходом в секунду длиной — ровно, без своего таймера.
 */
export function ComposerRoundPreview({
  stream,
  seconds,
}: {
  stream: MediaStream
  seconds: number
}) {
  const t = useTranslations('Chats')
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.srcObject = stream
    void v.play().catch(() => undefined)
    return () => {
      v.srcObject = null
    }
  }, [stream])

  const progress = Math.min(1, seconds / ROUND_VIDEO_MAX_SECONDS)
  return (
    <div
      role="status"
      aria-label={t('tgMessage.roundRecording')}
      className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-6 size-60 max-h-[60vw] max-w-[60vw] -translate-x-1/2 duration-(--motion-menu) animate-in fade-in-0 zoom-in-90 motion-reduce:animate-none"
    >
      <div className="absolute inset-0 overflow-hidden rounded-full bg-black shadow-2xl">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className="size-full -scale-x-100 object-cover"
        />
      </div>
      <svg
        viewBox="0 0 100 100"
        aria-hidden
        className="absolute -inset-2 size-[calc(100%+1rem)] -rotate-90"
      >
        <circle
          cx="50"
          cy="50"
          r={RING_R}
          fill="none"
          className="stroke-destructive transition-[stroke-dashoffset] duration-1000 ease-linear motion-reduce:transition-none"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - progress)}
        />
      </svg>
    </div>
  )
}
