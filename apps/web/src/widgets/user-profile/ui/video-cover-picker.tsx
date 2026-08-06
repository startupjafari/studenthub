'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Loader2 } from 'lucide-react'
import { cn } from '../../../shared/lib/utils'

export interface VideoCover {
  time: number
  blob: Blob
}

interface Frame {
  time: number
  url: string
  blob: Blob
}

const FRAME_INTERVAL = 2 // секунды между кадрами
const MAX_FRAMES = 8 // раскадровка первых кадров (для выбора обложки)
const THUMB_LONG_SIDE = 480 // длинная сторона кадра-обложки, px

// Ждём завершения перемотки видео на нужную секунду.
function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked)
      resolve()
    }
    video.addEventListener('seeked', onSeeked)
    video.currentTime = time
  })
}

// Раскадровка видео на клиенте: кадры каждые 2 сек (до MAX_FRAMES) + выбор обложки.
export function VideoCoverPicker({
  file,
  onCover,
}: {
  file: File
  onCover: (cover: VideoCover | null) => void
}) {
  const t = useTranslations('Profile')
  const [frames, setFrames] = useState<Frame[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(0)
  // Держим последнюю версию onCover без ре-запуска извлечения кадров.
  const onCoverRef = useRef(onCover)
  onCoverRef.current = onCover

  useEffect(() => {
    let cancelled = false
    const src = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.src = src
    video.muted = true
    video.preload = 'metadata'
    const created: Frame[] = []

    async function run() {
      setLoading(true)
      await new Promise<void>((res, rej) => {
        video.onloadedmetadata = () => res()
        video.onerror = () => rej(new Error('video load error'))
      })
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      const times: number[] = []
      for (let time = 0; times.length < MAX_FRAMES; time += FRAME_INTERVAL) {
        // Не перематываем в самый конец — там часто пустой кадр.
        if (time > Math.max(duration - 0.1, 0) && times.length > 0) break
        times.push(Math.min(time, Math.max(duration - 0.1, 0)))
        if (duration === 0) break
      }
      const w = video.videoWidth || 16
      const h = video.videoHeight || 9
      const scale = THUMB_LONG_SIDE / Math.max(w, h)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(w * scale))
      canvas.height = Math.max(1, Math.round(h * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      for (const time of times) {
        if (cancelled) return
        await seek(video, time)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
        if (!blob) continue
        created.push({ time, url: URL.createObjectURL(blob), blob })
        if (!cancelled) setFrames([...created])
      }
      if (cancelled) return
      setLoading(false)
      // По умолчанию — первый кадр.
      if (created[0]) onCoverRef.current({ time: created[0].time, blob: created[0].blob })
    }

    run().catch(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
      URL.revokeObjectURL(src)
      created.forEach((f) => URL.revokeObjectURL(f.url))
    }
  }, [file])

  function pick(i: number) {
    const f = frames[i]
    if (!f) return
    setSelected(i)
    onCover({ time: f.time, blob: f.blob })
  }

  if (loading && frames.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {t('framesLoading')}
      </div>
    )
  }
  if (frames.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('coverHint')}
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {frames.map((f, i) => (
          <button
            key={f.time}
            type="button"
            onClick={() => pick(i)}
            aria-label={t('coverFrame', { s: Math.round(f.time) })}
            className={cn(
              'relative aspect-video h-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors',
              selected === i ? 'border-primary' : 'border-transparent hover:border-border',
            )}
          >
            {/* Локальный кадр — обычный img (объектный URL). */}
            <img src={f.url} alt="" className="size-full object-cover" />
            {selected === i && (
              <span className="absolute inset-0 flex items-center justify-center bg-primary/25">
                <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3.5" aria-hidden />
                </span>
              </span>
            )}
          </button>
        ))}
        {loading && (
          <span className="flex h-16 w-24 shrink-0 items-center justify-center rounded-lg border border-dashed border-border">
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          </span>
        )}
      </div>
    </div>
  )
}
