'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Play, RotateCw, VolumeX, X } from 'lucide-react'
import { prefersReducedMotion } from '../../../shared/lib'
import { ProgressRing } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { useAttachmentLinkSource } from './attachment-link-source'
import type { MessageAttachment } from '../model/types'

// Диаметр кружка, как в Telegram (15rem); на узком экране — не шире 70% ширины.
const ROUND = 'size-60 max-w-[70vw] max-h-[70vw]'
// Кольцо прогресса воспроизведения: в координатах viewBox 0..100.
const RING_R = 48
const RING_C = 2 * Math.PI * RING_R

/**
 * Со звуком в ленте играет один кружок — как в Telegram. Запуск следующего останавливает
 * предыдущий и возвращает его в беззвучное превью.
 */
let stopCurrent: (() => void) | null = null

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function saveData(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return c?.saveData === true
}

/**
 * Кружок (видеосообщение), как в Telegram: круг без пузыря.
 *
 * - У экрана — беззвучное превью по кругу (если человек не просил меньше движения и не
 *   экономит трафик): так кружок «живой» и без нажатия.
 * - Нажатие — воспроизведение со звуком с начала, по краю бежит кольцо прогресса; повторное
 *   нажатие — пауза. Доиграл — снова беззвучное превью.
 * - Пока ролик едет на сервер — кольцо загрузки и отмена; не ушёл — круг повтора.
 */
export function RoundVideo({
  att,
  onCancel,
  sendFailed = false,
  onRetry,
}: {
  att: MessageAttachment
  onCancel?: () => void
  sendFailed?: boolean
  onRetry?: () => void
}) {
  const t = useTranslations('Chats')
  const source = useAttachmentLinkSource()
  const hasLocal = !!att.localUrl
  // Ключ тот же, что у остальных вложений: ссылка, полученная где угодно, переиспользуется.
  const link = useQuery({
    queryKey: [source.scope, att.id],
    queryFn: () => source.fetch(att.id),
    enabled: !hasLocal,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })
  const url = att.localUrl ?? link.data?.url
  const poster = link.data?.poster.at(-1)?.url ?? att.placeholder ?? undefined

  const rootRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const ringRef = useRef<SVGCircleElement | null>(null)
  const [near, setNear] = useState(false)
  const [active, setActive] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [broken, setBroken] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState<number | null>(
    att.durationMs ? att.durationMs / 1000 : null,
  )

  const failedSend = sendFailed && !!att.uploading
  const uploading = !!att.uploading && !sendFailed
  // Беззвучное превью: только у экрана, без запроса меньше движения и без экономии трафика.
  const preview = near && !active && !uploading && !prefersReducedMotion() && !saveData()

  function deactivate(): void {
    const v = videoRef.current
    setActive(false)
    setPlaying(false)
    setTime(0)
    if (!v) return
    v.pause()
    v.muted = true
    v.loop = true
    v.currentTime = 0
  }
  const deactivateRef = useRef(deactivate)
  deactivateRef.current = deactivate

  // Кружок у экрана: превью играет, ушёл — останавливается (и не тратит батарею).
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Превью: включаем/выключаем по видимости.
  useEffect(() => {
    const v = videoRef.current
    if (!v || active) return
    v.muted = true
    v.loop = true
    if (preview) void v.play().catch(() => undefined)
    else v.pause()
  }, [preview, active, url])

  // Кольцо прогресса пишется в DOM каждый кадр, мимо React: перерисовывать пузырь 60 раз в
  // секунду ради одного атрибута незачем.
  useEffect(() => {
    if (!active) return
    let raf = 0
    const tick = (): void => {
      const v = videoRef.current
      if (v && ringRef.current && v.duration > 0 && Number.isFinite(v.duration)) {
        const p = v.currentTime / v.duration
        ringRef.current.setAttribute('stroke-dashoffset', String(RING_C * (1 - p)))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])

  // Уходя из ленты (виртуализация, смена чата), не оставляем звук играть без кружка.
  useEffect(
    () => () => {
      if (stopCurrent === deactivateRef.current) stopCurrent = null
    },
    [],
  )

  function toggle(): void {
    const v = videoRef.current
    if (!v || !url) return
    if (!active) {
      if (stopCurrent && stopCurrent !== deactivateRef.current) stopCurrent()
      stopCurrent = () => deactivateRef.current()
      setActive(true)
      v.loop = false
      v.muted = false
      v.currentTime = 0
      void v.play().catch(() => deactivate())
      return
    }
    if (v.paused) void v.play().catch(() => undefined)
    else v.pause()
  }

  if (failedSend || broken || link.isError) {
    const label = failedSend ? t('sendFailedRetry') : t('mediaFailed')
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation()
          if (failedSend) onRetry?.()
          else {
            setBroken(false)
            void link.refetch()
          }
        }}
        className={cn(
          ROUND,
          'flex cursor-pointer items-center justify-center rounded-full bg-foreground/10',
        )}
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-black/55 text-white">
          <RotateCw className="size-6" aria-hidden />
        </span>
      </button>
    )
  }

  const shownTime = active ? (duration ?? 0) - time : duration
  return (
    <div
      ref={rootRef}
      data-media-origin={att.id}
      className={cn(ROUND, 'relative shrink-0 select-none')}
    >
      <div className="absolute inset-0 overflow-hidden rounded-full bg-foreground/10">
        {att.placeholder && (
          <img
            src={att.placeholder}
            alt=""
            aria-hidden
            draggable={false}
            className="absolute inset-0 size-full scale-110 object-cover blur-lg"
          />
        )}
        {url && (
          <video
            ref={videoRef}
            src={url}
            poster={poster}
            muted
            loop
            playsInline
            preload={preview ? 'auto' : 'metadata'}
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration
              if (Number.isFinite(d) && d > 0) setDuration(d)
            }}
            // Со звуком играет только нажатый кружок — по звуку его и отличаем от превью:
            // замыкание на `active` могло бы застать прошлый рендер.
            onTimeUpdate={(e) => {
              if (!e.currentTarget.muted) setTime(e.currentTarget.currentTime)
            }}
            onPlay={(e) => {
              if (!e.currentTarget.muted) setPlaying(true)
            }}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              if (stopCurrent === deactivateRef.current) stopCurrent = null
              deactivate()
            }}
            onError={() => setBroken(true)}
            className="absolute inset-0 size-full object-cover"
          />
        )}
      </div>

      {/* Кольцо прогресса воспроизведения — по краю круга. */}
      {active && (
        <svg
          viewBox="0 0 100 100"
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full -rotate-90"
        >
          <circle
            ref={ringRef}
            cx="50"
            cy="50"
            r={RING_R}
            fill="none"
            stroke="white"
            strokeOpacity="0.85"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C}
          />
        </svg>
      )}

      {uploading ? (
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/30">
          <button
            type="button"
            aria-label={t('cancelUpload')}
            title={t('cancelUpload')}
            disabled={!onCancel}
            onClick={(e) => {
              e.stopPropagation()
              onCancel?.()
            }}
            className="relative flex size-12 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white disabled:cursor-default"
          >
            <X className="size-5" aria-hidden />
            <ProgressRing progress={att.progress ?? null} />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            toggle()
          }}
          aria-label={active && playing ? t('tgMessage.roundPause') : t('tgMessage.roundPlay')}
          aria-pressed={active && playing}
          className="absolute inset-0 cursor-pointer rounded-full outline-none focus-visible:ring-4 focus-visible:ring-ring/40"
        >
          {/* Пауза посреди круга — только когда ролик остановлен со звуком; в превью значка
              нет, как в Telegram: круг и так живой. */}
          {(active && !playing) || (!active && !preview) ? (
            <span className="absolute top-1/2 left-1/2 flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white">
              <Play className="size-6 translate-x-0.5 fill-current" aria-hidden />
            </span>
          ) : null}
        </button>
      )}

      {/* Длительность (при воспроизведении — сколько осталось) и значок «без звука» у превью. */}
      {!uploading && shownTime != null && (
        <span className="pointer-events-none absolute bottom-0 left-0 flex items-center gap-1 rounded-full bg-black/45 px-1.5 py-0.5 text-[0.6875rem] font-medium tabular-nums text-white">
          {formatClock(shownTime)}
          {!active && <VolumeX className="size-3" aria-hidden />}
        </span>
      )}
    </div>
  )
}
