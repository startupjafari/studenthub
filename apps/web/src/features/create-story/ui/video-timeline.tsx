'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useTranslations } from 'next-intl'
import type { VideoTrimInput } from '@studenthub/shared-schemas'
import { localMediaSrc } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'

/** Сколько кадров в раскадровке: хватает, чтобы узнать сцену, и быстро готовится. */
const FRAME_COUNT = 12
/** Высота кадра раскадровки в canvas, px (с запасом под плотный экран). */
const FRAME_HEIGHT = 96
/** Самый короткий отрезок, мс. */
const MIN_TRIM_MS = 1000
/** Шаг ручек с клавиатуры, мс; с Shift — крупнее. */
const KEY_STEP_MS = 100
const KEY_STEP_BIG_MS = 1000

/** «1:05» из миллисекунд. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Кадры раскадровки: ролик открывается отдельным невидимым <video>, перематывается по
 * точкам и рисуется в маленький canvas. Кадры появляются по одному, как готовы. Новый
 * ролик — раскадровка заново; ушли с экрана — перемотка прерывается.
 */
function useVideoFrames(url: string, durationMs: number): string[] {
  const [frames, setFrames] = useState<string[]>([])
  useEffect(() => {
    setFrames([])
    const src = localMediaSrc(url)
    if (durationMs <= 0 || !src) return
    let cancelled = false
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = src
    const once = (event: 'loadeddata' | 'seeked'): Promise<void> =>
      new Promise((resolve, reject) => {
        video.addEventListener(event, () => resolve(), { once: true })
        video.addEventListener('error', () => reject(new Error('video')), { once: true })
      })
    void (async () => {
      await once('loadeddata')
      const height = FRAME_HEIGHT
      const width = Math.max(1, Math.round((height * video.videoWidth) / (video.videoHeight || 1)))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const out: string[] = []
      for (let i = 0; i < FRAME_COUNT && !cancelled; i++) {
        const seeked = once('seeked')
        video.currentTime = (((i + 0.5) / FRAME_COUNT) * durationMs) / 1000
        await seeked
        ctx.drawImage(video, 0, 0, width, height)
        out.push(canvas.toDataURL('image/jpeg', 0.6))
        if (!cancelled) setFrames([...out])
      }
    })().catch(() => undefined)
    return () => {
      cancelled = true
      video.removeAttribute('src')
      video.load()
    }
  }, [url, durationMs])
  return frames
}

type Drag = { mode: 'start' | 'end' } | { mode: 'move'; offsetMs: number } | { mode: 'seek' }

/**
 * Раскадровка видео под кадром: полоса кадров, на ней — выбранный отрезок с ручками
 * начала и конца; за отрезком всё притемнено. Отрезок двигают целиком, ручки — по
 * отдельности, длина не больше `maxMs`. Справа — длина отрезка и потолок.
 * Белая черта — где сейчас превью; нажатие на полосу переводит превью туда.
 */
export function VideoTimeline({
  url,
  durationMs,
  trim,
  maxMs,
  currentMs,
  onTrim,
  onSeek,
}: {
  url: string
  durationMs: number
  trim: VideoTrimInput
  maxMs: number
  currentMs: number
  /** Отрезок меняется; `edge` — какой край тянут: превью показывает именно его. */
  onTrim: (trim: VideoTrimInput, edge: 'start' | 'end') => void
  onSeek: (ms: number) => void
}) {
  const t = useTranslations('Stories')
  const frames = useVideoFrames(url, durationMs)
  const stripRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [dragging, setDragging] = useState(false)

  const pct = (ms: number): string => `${(ms / durationMs) * 100}%`
  const length = trim.endMs - trim.startMs

  function msAt(clientX: number): number {
    const rect = stripRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return Math.round((ratio * durationMs) / 100) * 100
  }

  function setStart(ms: number): void {
    const startMs = Math.min(Math.max(ms, 0, trim.endMs - maxMs), trim.endMs - MIN_TRIM_MS)
    onTrim({ startMs: Math.max(0, startMs), endMs: trim.endMs }, 'start')
  }

  function setEnd(ms: number): void {
    const endMs = Math.max(
      Math.min(ms, durationMs, trim.startMs + maxMs),
      trim.startMs + MIN_TRIM_MS,
    )
    onTrim({ startMs: trim.startMs, endMs: Math.min(durationMs, endMs) }, 'end')
  }

  function begin(e: PointerEvent<HTMLElement>, next: Drag): void {
    e.stopPropagation()
    e.preventDefault()
    stripRef.current?.setPointerCapture(e.pointerId)
    drag.current = next
    setDragging(true)
  }

  function onMove(e: PointerEvent<HTMLDivElement>): void {
    const d = drag.current
    if (!d) return
    const ms = msAt(e.clientX)
    if (d.mode === 'start') setStart(ms)
    else if (d.mode === 'end') setEnd(ms)
    else if (d.mode === 'move') {
      const startMs = Math.min(Math.max(0, ms - d.offsetMs), durationMs - length)
      onTrim({ startMs, endMs: startMs + length }, 'start')
    } else onSeek(Math.min(Math.max(ms, trim.startMs), trim.endMs))
  }

  function onUp(e: PointerEvent<HTMLDivElement>): void {
    if (stripRef.current?.hasPointerCapture(e.pointerId)) {
      stripRef.current.releasePointerCapture(e.pointerId)
    }
    drag.current = null
    setDragging(false)
  }

  function onHandleKey(e: KeyboardEvent, edge: 'start' | 'end'): void {
    const step = e.shiftKey ? KEY_STEP_BIG_MS : KEY_STEP_MS
    const delta = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
    if (!delta) return
    e.preventDefault()
    if (edge === 'start') setStart(trim.startMs + delta)
    else setEnd(trim.endMs + delta)
  }

  const handle =
    'absolute inset-y-0 z-10 flex w-3 cursor-ew-resize touch-none items-center justify-center bg-primary outline-none focus-visible:ring-2 focus-visible:ring-white'

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div
        ref={stripRef}
        role="group"
        aria-label={t('videoTrim')}
        className="relative h-11 min-w-0 flex-1 touch-none rounded-lg bg-white/5 select-none"
        onPointerDown={(e) => {
          begin(e, { mode: 'seek' })
          onSeek(Math.min(Math.max(msAt(e.clientX), trim.startMs), trim.endMs))
        }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {/* Кадры */}
        <div aria-hidden className="absolute inset-0 flex overflow-hidden rounded-lg">
          {Array.from({ length: FRAME_COUNT }, (_, i) => (
            <div key={i} className="h-full min-w-0 flex-1 bg-white/5">
              {frames[i] && (
                // data-URL кадра из canvas: оптимизировать его next/image не может.
                <img src={frames[i]} alt="" className="size-full object-cover" />
              )}
            </div>
          ))}
        </div>

        {/* За отрезком — притемнено */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-l-lg bg-black/65"
          style={{ width: pct(trim.startMs) }}
        />
        <div
          aria-hidden
          className="absolute inset-y-0 right-0 rounded-r-lg bg-black/65"
          style={{ width: pct(durationMs - trim.endMs) }}
        />

        {/* Отрезок: рамка, тянется целиком; ручки по краям */}
        <div
          className={cn(
            'absolute inset-y-0 cursor-grab rounded-lg border-y-2 border-primary',
            dragging && 'cursor-grabbing',
          )}
          style={{ left: pct(trim.startMs), width: pct(length) }}
          onPointerDown={(e) =>
            begin(e, { mode: 'move', offsetMs: msAt(e.clientX) - trim.startMs })
          }
        >
          <span
            role="slider"
            tabIndex={0}
            aria-label={t('videoTrimStart')}
            aria-valuemin={0}
            aria-valuemax={durationMs}
            aria-valuenow={trim.startMs}
            aria-valuetext={formatClock(trim.startMs)}
            className={cn(handle, '-left-1.5 rounded-l-lg')}
            onPointerDown={(e) => begin(e, { mode: 'start' })}
            onKeyDown={(e) => onHandleKey(e, 'start')}
          >
            <span className="h-4 w-0.5 rounded-full bg-white/90" />
          </span>
          <span
            role="slider"
            tabIndex={0}
            aria-label={t('videoTrimEnd')}
            aria-valuemin={0}
            aria-valuemax={durationMs}
            aria-valuenow={trim.endMs}
            aria-valuetext={formatClock(trim.endMs)}
            className={cn(handle, '-right-1.5 rounded-r-lg')}
            onPointerDown={(e) => begin(e, { mode: 'end' })}
            onKeyDown={(e) => onHandleKey(e, 'end')}
          >
            <span className="h-4 w-0.5 rounded-full bg-white/90" />
          </span>
        </div>

        {/* Где сейчас превью */}
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-white shadow"
          style={{ left: pct(Math.min(Math.max(currentMs, 0), durationMs)) }}
        />
      </div>

      {/* Длина отрезка и потолок */}
      <div className="flex w-14 shrink-0 flex-col items-end leading-tight">
        <span className="text-sm font-semibold tabular-nums">{formatClock(length)}</span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {t('trimMax', { max: formatClock(maxMs) })}
        </span>
      </div>
    </div>
  )
}
