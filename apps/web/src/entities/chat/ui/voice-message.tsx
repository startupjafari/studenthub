'use client'

import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { cn } from '../../../shared/lib/utils'

const BAR_COUNT = 40
const BAR_W = 3
const GAP = 2
const WAVE_WIDTH = BAR_COUNT * BAR_W + (BAR_COUNT - 1) * GAP

// Детерминированные высоты полос волны по id файла (без декодирования аудио — надёжно, без CORS).
function seededBars(seed: string, n: number): number[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0
  const bars: number[] = []
  for (let i = 0; i < n; i++) {
    h = (Math.imul(h, 1103515245) + 12345) & 0x7fffffff
    bars.push(0.25 + ((h % 1000) / 1000) * 0.75)
  }
  return bars
}

function mmss(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// Единственное активное голосовое: старт нового ставит предыдущее на паузу (как в Telegram).
let activeAudio: HTMLAudioElement | null = null

// Голосовое сообщение в стиле Telegram/WhatsApp (Ф9+): круглая кнопка play/pause, волна с плавной
// заливкой прогресса (requestAnimationFrame), перемотка кликом, длительность. `mine` — тема на фоне пузыря.
export function VoiceMessage({ url, seed, mine }: { url: string; seed: string; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const waveRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef(0)
  const durationRef = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const bars = useRef(seededBars(seed, BAR_COUNT)).current

  // webm от MediaRecorder часто без длительности — форсируем её вычисление.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const setDur = (d: number): void => {
      durationRef.current = d
      setDuration(d)
    }
    const onMeta = (): void => {
      if (audio.duration === Infinity || Number.isNaN(audio.duration)) {
        const onSeek = (): void => {
          audio.removeEventListener('timeupdate', onSeek)
          setDur(audio.duration)
          audio.currentTime = 0
        }
        audio.addEventListener('timeupdate', onSeek)
        audio.currentTime = 1e101
      } else {
        setDur(audio.duration)
      }
    }
    const onTime = (): void => setCurrent(audio.currentTime)
    // Старт этого — пауза предыдущего активного. Состояние playing ведём от событий аудио.
    const onPlay = (): void => {
      if (activeAudio && activeAudio !== audio) activeAudio.pause()
      activeAudio = audio
      setPlaying(true)
    }
    const onPause = (): void => setPlaying(false)
    const onEnd = (): void => {
      setPlaying(false)
      setCurrent(0)
      if (overlayRef.current) overlayRef.current.style.width = '0%'
      if (activeAudio === audio) activeAudio = null
    }
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnd)
    return () => {
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnd)
      if (activeAudio === audio) activeAudio = null
    }
  }, [url])

  // Плавная заливка прогресса: обновляем ширину оверлея каждый кадр во время воспроизведения.
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current)
      return
    }
    const loop = (): void => {
      const audio = audioRef.current
      const dur = durationRef.current
      if (audio && dur > 0 && overlayRef.current) {
        overlayRef.current.style.width = `${Math.min(100, (audio.currentTime / dur) * 100)}%`
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing])

  function toggle(): void {
    const audio = audioRef.current
    if (!audio) return
    // Состояние playing обновится обработчиками событий play/pause.
    if (audio.paused) void audio.play()
    else audio.pause()
  }

  function seek(e: React.MouseEvent<HTMLDivElement>): void {
    const audio = audioRef.current
    const dur = durationRef.current
    if (!audio || !Number.isFinite(dur) || dur <= 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    audio.currentTime = ratio * dur
    setCurrent(audio.currentTime)
    if (overlayRef.current) overlayRef.current.style.width = `${ratio * 100}%`
  }

  const staticProgress = duration > 0 ? Math.min(100, (current / duration) * 100) : 0
  const played = mine ? 'bg-primary-foreground' : 'bg-primary'
  const rest = mine ? 'bg-primary-foreground/35' : 'bg-primary/25'

  const barRow = (color: string): React.ReactNode => (
    <div className="flex h-6 items-center" style={{ width: WAVE_WIDTH, gap: GAP }}>
      {bars.map((hgt, i) => (
        <span
          key={i}
          className={cn('shrink-0 rounded-full', color)}
          style={{ width: BAR_W, height: `${Math.round(hgt * 100)}%` }}
        />
      ))}
    </div>
  )

  return (
    <div className="flex min-w-[220px] max-w-full items-center gap-2.5 py-0.5">
      <audio ref={audioRef} src={url} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'pause' : 'play'}
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full',
          mine ? 'bg-primary-foreground text-primary' : 'bg-primary text-primary-foreground',
        )}
      >
        {playing ? (
          <Pause className="size-4" aria-hidden />
        ) : (
          <Play className="size-4 translate-x-px" aria-hidden />
        )}
      </button>
      <div className="flex min-w-0 flex-col gap-1">
        <div
          ref={waveRef}
          onClick={seek}
          role="presentation"
          className="relative cursor-pointer"
          style={{ width: WAVE_WIDTH }}
        >
          {barRow(rest)}
          {/* Плавно растущий оверлей проигранной части */}
          <div
            ref={overlayRef}
            className="absolute inset-y-0 left-0 overflow-hidden"
            style={{ width: `${staticProgress}%` }}
          >
            {barRow(played)}
          </div>
        </div>
        <span
          className={cn(
            'text-[0.7rem] tabular-nums',
            mine ? 'opacity-80' : 'text-muted-foreground',
          )}
        >
          {mmss(playing || current > 0 ? current : duration)}
        </span>
      </div>
    </div>
  )
}
