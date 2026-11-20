'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, Pause, Play } from 'lucide-react'
import { formatBytes, useByteUnitLabel } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import {
  getAudioElement,
  LONG_AUDIO_SEC,
  playAudioTrack,
  retainAudioPlayer,
  seekAudioRatio,
  toggleAudio,
  useAudioPlayer,
  type AudioTrack,
} from '../lib/audio-player'
import { VoiceRateButton } from './voice-rate-button'
import type { VoiceTrackMeta } from './voice-message'

/** `3:05`, `1:02:30` — длительность песни. */
export function formatTrackTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

/** Название трека из имени файла: у Telegram там тег title, у нас — имя без расширения. */
export function trackTitle(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? ''
  return trimmed.replace(/\.[^.\s]{1,8}$/, '') || trimmed
}

/**
 * Музыка в пузыре, как в Telegram: круглая кнопка ▶ 48 px, справа название трека и под ним
 * длительность с весом файла; у начатого трека вторая строка становится временем и полосой
 * перемотки. Волны нет — она у голосовых.
 *
 * Высота строки постоянна (кнопка задаёт её) и не зависит ни от ссылки, ни от разбора файла:
 * ленте без виртуализации нужен пузырь, который не меняет размер после загрузки. Ссылка не
 * обязательна — без неё общий плеер спросит её у очереди чата сам.
 */
export function MusicMessage({
  url,
  seed,
  name,
  size,
  durationMs,
  mine,
  meta,
}: {
  url?: string
  /** id вложения — ключ трека в общем плеере. */
  seed: string
  name: string | null | undefined
  size: number
  durationMs?: number | null
  mine: boolean
  meta?: VoiceTrackMeta
}) {
  const t = useTranslations('Chats')
  const unit = useByteUnitLabel()
  const player = useAudioPlayer()
  const isCurrent = player.track?.id === seed
  const playing = isCurrent && player.playing
  const [current, setCurrent] = useState(0)
  const fillRef = useRef<HTMLDivElement | null>(null)
  const title = trackTitle(name) || t('previewMusic', { n: 1 })
  const known = durationMs ? durationMs / 1000 : 0
  const duration = (isCurrent && player.duration) || known

  // Время и заливка полосы — по событиям общего элемента, пока этот трек текущий.
  useEffect(() => {
    if (!isCurrent) {
      setCurrent(0)
      return
    }
    const a = getAudioElement()
    if (!a) return
    const onTime = (): void => {
      const now = Number.isFinite(a.currentTime) ? a.currentTime : 0
      const d = (Number.isFinite(a.duration) && a.duration) || duration
      // Пока плеер досчитывает длительность, указатель стоит «в бесконечности».
      if (d > 0 && now > d + 1) return
      setCurrent(now)
      if (fillRef.current && d > 0)
        fillRef.current.style.width = `${Math.min(100, (now / d) * 100)}%`
    }
    onTime()
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('seeked', onTime)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('seeked', onTime)
    }
  }, [isCurrent, duration])

  useEffect(() => (isCurrent ? retainAudioPlayer() : undefined), [isCurrent])

  const track = (): AudioTrack => ({
    id: seed,
    url,
    voice: false,
    title: meta?.title ?? title,
    performer: meta?.performer,
    createdAt: meta?.createdAt,
    onGoTo: meta?.onGoTo,
    duration: known || undefined,
  })

  const toggle = (): void => {
    if (isCurrent) toggleAudio()
    else playAudioTrack(track())
  }

  const seek = (e: React.MouseEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    if (isCurrent) seekAudioRatio(ratio)
    else playAudioTrack(track(), ratio)
  }

  const started = isCurrent && (playing || current > 0)
  const secondary = mine ? 'opacity-70' : 'text-muted-foreground'

  return (
    <div className="flex min-w-[14rem] max-w-full items-center gap-3 py-0.5">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t('pause') : t('play')}
        className={cn(
          'flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full transition-transform active:scale-95',
          mine ? 'bg-primary-foreground text-primary' : 'bg-primary text-primary-foreground',
        )}
      >
        {isCurrent && player.loading ? (
          <Loader2 className="size-5 animate-spin" aria-hidden />
        ) : playing ? (
          <Pause className="size-5 fill-current" aria-hidden />
        ) : (
          <Play className="size-5 translate-x-px fill-current" aria-hidden />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base leading-tight font-medium" title={name ?? undefined}>
          {title}
        </p>
        <div className={cn('mt-0.5 flex h-5 items-center gap-2 text-sm tabular-nums', secondary)}>
          {started ? (
            <>
              <span className="shrink-0">{formatTrackTime(current)}</span>
              {/* Полоса перемотки Telegram: тонкая линия, проигранное — цветом кнопки. */}
              <div
                role="presentation"
                onClick={seek}
                className="relative h-4 flex-1 cursor-pointer"
              >
                <span
                  className={cn(
                    'absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full',
                    mine ? 'bg-primary-foreground/35' : 'bg-primary/25',
                  )}
                />
                <div
                  ref={fillRef}
                  className={cn(
                    'absolute top-1/2 left-0 h-0.5 -translate-y-1/2 rounded-full',
                    mine ? 'bg-primary-foreground' : 'bg-primary',
                  )}
                  style={{ width: duration > 0 ? `${(current / duration) * 100}%` : 0 }}
                />
              </div>
            </>
          ) : (
            <span className="truncate">
              {duration > 0 ? `${formatTrackTime(duration)} · ` : ''}
              {formatBytes(size, unit)}
            </span>
          )}
        </div>
      </div>
      {/* Скорость — только у длинных записей (подкаст, лекция), как в Telegram. */}
      {started && duration >= LONG_AUDIO_SEC && (
        <VoiceRateButton tone={mine ? 'onPrimary' : 'default'} className="self-start" />
      )}
    </div>
  )
}
