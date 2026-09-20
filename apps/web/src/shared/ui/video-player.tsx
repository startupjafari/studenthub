'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslations } from 'next-intl'
import { Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { cn } from '../lib'

// Видеоплеер платформы: свои контролы вместо системных.
//
// `playsInline` — главное: без него iOS на первом же `play()` забирает видео в собственный
// полноэкранный плеер, и пользователь оказывается в интерфейсе телефона, а не приложения.
// Дальше всё наше: полоса воспроизведения с перемоткой, время, звук — в той же тёмной хроме,
// что и просмотрщик.
//
// Панель прячется сама, пока видео играет, и остаётся на месте на паузе. Разметка контролов
// помечена `data-gesture-skip`: жесты просмотрщика (листание, зум) на ней не начинаются,
// иначе перемотка превращалась бы в листание.

/** Через сколько бездействия прячем панель во время воспроизведения. */
const HIDE_AFTER_MS = 2500
/** Шаг перемотки с клавиатуры. */
const SEEK_STEP_SEC = 5

function mmss(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function VideoPlayer({
  src,
  autoPlay = false,
  className,
  videoClassName,
  videoStyle,
  onVideoRef,
  onLoadedMetadata,
}: {
  src: string
  autoPlay?: boolean
  className?: string
  videoClassName?: string
  /** Трансформация самого кадра (поворот, вписывание) — панель контролов не трогает. */
  videoStyle?: CSSProperties
  onVideoRef?: (el: HTMLVideoElement | null) => void
  onLoadedMetadata?: () => void
}) {
  const t = useTranslations('Common')
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const [visible, setVisible] = useState(true)
  const [scrubbing, setScrubbing] = useState(false)
  const playedRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const attach = useCallback(
    (el: HTMLVideoElement | null): void => {
      setVideo(el)
      onVideoRef?.(el)
    },
    [onVideoRef],
  )

  useEffect(() => {
    if (!video) return
    const onMeta = (): void => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0)
      onLoadedMetadata?.()
    }
    const onTime = (): void => setCurrent(video.currentTime)
    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => setPlaying(false)
    const onVolume = (): void => setMuted(video.muted)
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('durationchange', onMeta)
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onPause)
    video.addEventListener('volumechange', onVolume)
    return () => {
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('durationchange', onMeta)
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onPause)
      video.removeEventListener('volumechange', onVolume)
    }
  }, [video, onLoadedMetadata])

  // Полоса растёт каждый кадр, а не по `timeupdate`: тот приходит раз в четверть секунды,
  // и полоса дёргалась бы ступеньками. Пишем ширину прямо в DOM — без ререндера на кадр.
  useEffect(() => {
    if (!video || !playing) return
    let frame = 0
    const loop = (): void => {
      const bar = playedRef.current
      const dur = video.duration
      if (bar && Number.isFinite(dur) && dur > 0) {
        bar.style.width = `${Math.min(100, (video.currentTime / dur) * 100)}%`
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [video, playing])

  // Панель уходит сама, пока идёт воспроизведение: кадр важнее хромы. На паузе и во время
  // перемотки остаётся — там она и нужна.
  const keepVisible = useCallback((): void => {
    setVisible(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setVisible(false), HIDE_AFTER_MS)
  }, [])

  useEffect(() => {
    if (!playing || scrubbing) {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      setVisible(true)
      return
    }
    keepVisible()
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [playing, scrubbing, keepVisible])

  const toggle = useCallback((): void => {
    if (!video) return
    if (video.paused) void video.play().catch(() => undefined)
    else video.pause()
    keepVisible()
  }, [video, keepVisible])

  const seekTo = useCallback(
    (clientX: number): void => {
      const track = trackRef.current
      if (!video || !track) return
      const dur = video.duration
      if (!Number.isFinite(dur) || dur <= 0) return
      const r = track.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
      video.currentTime = ratio * dur
      setCurrent(video.currentTime)
      if (playedRef.current) playedRef.current.style.width = `${ratio * 100}%`
    },
    [video],
  )

  const nudge = useCallback(
    (delta: number): void => {
      if (!video) return
      const dur = video.duration
      if (!Number.isFinite(dur) || dur <= 0) return
      video.currentTime = Math.min(dur, Math.max(0, video.currentTime + delta))
      setCurrent(video.currentTime)
      keepVisible()
    },
    [video, keepVisible],
  )

  const progress = duration > 0 ? Math.min(100, (current / duration) * 100) : 0

  return (
    <div className={cn('relative flex h-full w-full items-center justify-center', className)}>
      <video
        ref={attach}
        src={src}
        autoPlay={autoPlay}
        playsInline
        preload="metadata"
        className={cn('h-full max-h-full w-auto max-w-full object-contain', videoClassName)}
        style={videoStyle}
        onClick={(e) => {
          // Тап по кадру не закрывает просмотрщик — он зовёт панель обратно.
          e.stopPropagation()
          if (visible && playing) setVisible(false)
          else keepVisible()
        }}
      />

      {/* Крупная кнопка по центру — пока видео стоит, играть его главное действие */}
      {!playing && (
        <button
          type="button"
          data-gesture-skip="true"
          aria-label={t('play')}
          onClick={(e) => {
            e.stopPropagation()
            toggle()
          }}
          className="absolute flex size-16 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
        >
          <Play className="size-8 translate-x-0.5" aria-hidden />
        </button>
      )}

      <div
        data-gesture-skip="true"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/70 to-transparent px-3 pb-3 pt-8 transition-opacity duration-200',
          visible ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <button
          type="button"
          aria-label={playing ? t('pause') : t('play')}
          onClick={toggle}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/10 hover:text-white"
        >
          {playing ? (
            <Pause className="size-5" aria-hidden />
          ) : (
            <Play className="size-5 translate-x-px" aria-hidden />
          )}
        </button>

        <span className="shrink-0 text-xs text-white/80 tabular-nums">{mmss(current)}</span>

        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label={t('seek')}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
          aria-valuetext={mmss(current)}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            setScrubbing(true)
            seekTo(e.clientX)
          }}
          onPointerMove={(e) => {
            if (scrubbing) seekTo(e.clientX)
          }}
          onPointerUp={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId)
            }
            setScrubbing(false)
          }}
          onKeyDown={(e) => {
            // Стрелки здесь перематывают, а не листают медиа: гасим их для просмотрщика.
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.stopPropagation()
              e.preventDefault()
              nudge(e.key === 'ArrowLeft' ? -SEEK_STEP_SEC : SEEK_STEP_SEC)
            } else if (e.key === ' ' || e.key === 'Enter') {
              e.stopPropagation()
              e.preventDefault()
              toggle()
            }
          }}
          className="group flex min-w-0 flex-1 cursor-pointer touch-none items-center py-3 outline-none"
        >
          <div className="relative h-1 w-full rounded-full bg-white/25">
            <div
              ref={playedRef}
              className="absolute inset-y-0 left-0 rounded-full bg-white"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <span className="shrink-0 text-xs text-white/80 tabular-nums">{mmss(duration)}</span>

        <button
          type="button"
          aria-label={muted ? t('unmute') : t('mute')}
          onClick={() => {
            if (!video) return
            video.muted = !video.muted
            keepVisible()
          }}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/10 hover:text-white"
        >
          {muted ? (
            <VolumeX className="size-5" aria-hidden />
          ) : (
            <Volume2 className="size-5" aria-hidden />
          )}
        </button>
      </div>
    </div>
  )
}
