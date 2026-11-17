'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { VoiceRateButton } from './voice-rate-button'
import { Pause, Play } from 'lucide-react'
import { cn } from '../../../shared/lib/utils'
import { BAR_FLOOR, resampleEnvelope, useVoiceProfile, voiceBarCount } from '../lib/voice-profile'
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

/** Что пузырь знает о записи для панели плеера: автор, когда, куда вести «к сообщению». */
export type VoiceTrackMeta = Pick<
  AudioTrack,
  'voice' | 'title' | 'performer' | 'createdAt' | 'onGoTo'
>

const BAR_W = 3
const GAP = 2

// Запасная волна, когда запись не удалось разобрать (чужой кодек, оборвалась сеть, файл
// слишком велик): детерминированный узор по id файла. Не громкость, но и не прямая линия —
// у каждого голосового он свой и не меняется между открытиями чата.
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

/**
 * Голосовое сообщение в стиле Telegram (Ф9+): круглая кнопка play/pause, волна с плавной
 * заливкой прогресса, перемотка кликом, длительность. `mine` — тема на фоне пузыря.
 *
 * Играет не свой <audio>, а общий плеер чатов (lib/audio-player): прокрутили пузырь за край
 * ленты — звук не обрывается, панель под шапкой показывает, что играет, а следующее
 * голосовое начинается само. Свой элемент у пузыря остался только ради длительности.
 *
 * Волна рисует настоящую громкость записи, а ширина волны — её длительность: секундное
 * голосовое узкое, двадцатисекундное во всю ширину пузыря. И то и другое берётся из
 * разобранного звука (`useVoiceProfile`), поэтому до разбора волна стоит на средней ширине
 * и один раз перестраивается — ждать здесь нечего, звук играется и без неё.
 */
export function VoiceMessage({
  url,
  seed,
  mine,
  size,
  meta,
}: {
  url: string
  /** id вложения: и затравка запасной волны, и ключ трека в общем плеере. */
  seed: string
  mine: boolean
  /** Вес файла: по нему решаем, стоит ли вообще разбирать запись ради волны. */
  size: number
  /** Подписи для панели плеера; нет — панель покажет запись без автора. */
  meta?: VoiceTrackMeta
}) {
  const t = useTranslations('Chats')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef(0)
  const durationRef = useRef(0)
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const voice = useVoiceProfile(url, seed, size)
  const player = useAudioPlayer()
  // Этот ли пузырь сейчас в общем плеере: только тогда он рисует прогресс и паузу.
  const isCurrent = player.track?.id === seed
  const playing = isCurrent && player.playing

  // Длительность у контейнера от MediaRecorder обычно не записана, поэтому пока она не
  // известна ни от элемента, ни из разбора — волна стоит на средней ширине.
  const known = voice?.duration ?? duration
  const bars = useMemo(() => {
    const n = voiceBarCount(known)
    return voice ? resampleEnvelope(voice.envelope, n) : seededBars(seed, n)
  }, [voice, seed, known])
  // Ширина — ровно под полосы, но не шире пузыря: на узком экране полосы сжимаются сами
  // (flex-1), и волна остаётся целой, а не уезжает за край.
  const waveWidth = bars.length * BAR_W + (bars.length - 1) * GAP

  // Разобранная запись знает длительность точно — она главнее того, что сказал элемент.
  useEffect(() => {
    if (!voice) return
    durationRef.current = voice.duration
    setDuration(voice.duration)
  }, [voice])

  // webm от MediaRecorder часто без длительности — форсируем её вычисление. Свой элемент
  // пузыря только для этого: он не играет, звук — в общем плеере.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const setDur = (d: number): void => {
      durationRef.current = d
      setDuration(d)
    }
    let forcing = false
    const onMeta = (): void => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDur(audio.duration)
        return
      }
      // webm/opus от MediaRecorder часто без длительности (Infinity). Форсируем: прыжок в «конец»
      // заставляет браузер досчитать длительность (durationchange), затем возвращаем указатель в 0.
      if (forcing) return
      forcing = true
      try {
        audio.currentTime = 1e101
      } catch {
        /* некоторые браузеры бросают на seek без длительности — тогда просто ждём durationchange */
      }
    }
    const onDurationChange = (): void => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDur(audio.duration)
        if (forcing) {
          forcing = false
          try {
            audio.currentTime = 0
          } catch {
            /* игнорируем */
          }
        }
      }
    }
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('durationchange', onDurationChange)
    return () => {
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('durationchange', onDurationChange)
    }
  }, [url])

  // Играет этот пузырь — время в подписи идёт по событиям общего элемента. Перестал быть
  // текущим (закончился, переключили на другой) — заливка сбрасывается в начало.
  useEffect(() => {
    const overlay = overlayRef.current
    if (!isCurrent) {
      setCurrent(0)
      if (overlay) overlay.style.clipPath = 'inset(0 100% 0 0)'
      return
    }
    const a = getAudioElement()
    if (!a) return
    const onTime = (): void => {
      const now = Number.isFinite(a.currentTime) ? a.currentTime : 0
      const dur = durationRef.current || player.duration
      // Пока общий плеер досчитывает длительность webm, указатель стоит «в бесконечности»:
      // такое время не показываем.
      if (dur > 0 && now > dur + 1) return
      setCurrent(now)
      if (overlay && dur > 0) {
        overlay.style.clipPath = `inset(0 ${100 - Math.min(100, (now / dur) * 100)}% 0 0)`
      }
    }
    onTime()
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('seeked', onTime)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('seeked', onTime)
    }
  }, [isCurrent, player.duration])

  // Пузырь текущего трека на экране — звук «кому-то показан» (см. retainAudioPlayer).
  useEffect(() => (isCurrent ? retainAudioPlayer() : undefined), [isCurrent])

  // Плавная заливка прогресса: обрезаем копию волны по кадрам, пока она играет. Обрезкой,
  // а не шириной: копия лежит во всю ширину волны и её полосы стоят ровно под своими.
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current)
      return
    }
    const loop = (): void => {
      const audio = getAudioElement()
      const dur = durationRef.current || audio?.duration || 0
      // Указатель «в бесконечности» — общий плеер досчитывает длительность webm: пропускаем.
      if (
        audio &&
        Number.isFinite(dur) &&
        dur > 0 &&
        audio.currentTime <= dur + 1 &&
        overlayRef.current
      ) {
        const done = Math.min(100, (audio.currentTime / dur) * 100)
        overlayRef.current.style.clipPath = `inset(0 ${100 - done}% 0 0)`
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing])

  /** Трек этого пузыря для общего плеера. */
  const track = (): AudioTrack => ({
    id: seed,
    url,
    voice: meta?.voice ?? true,
    title: meta?.title ?? '',
    performer: meta?.performer,
    createdAt: meta?.createdAt,
    onGoTo: meta?.onGoTo,
    duration: durationRef.current || undefined,
  })

  function toggle(): void {
    if (isCurrent) toggleAudio()
    else playAudioTrack(track())
  }

  function seek(e: React.MouseEvent<HTMLDivElement>): void {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    // Нажали посреди волны ещё не игравшего — начинаем с этого места (как в Telegram).
    if (isCurrent) seekAudioRatio(ratio)
    else playAudioTrack(track(), ratio)
    if (overlayRef.current) {
      overlayRef.current.style.clipPath = `inset(0 ${100 - ratio * 100}% 0 0)`
    }
  }

  const staticProgress = duration > 0 ? Math.min(100, (current / duration) * 100) : 0
  const played = mine ? 'bg-primary-foreground' : 'bg-primary'
  const rest = mine ? 'bg-primary-foreground/35' : 'bg-primary/25'

  const barRow = (color: string): ReactNode => (
    <div className="flex h-6 w-full items-center" style={{ gap: GAP }}>
      {bars.map((hgt, i) => (
        <span
          key={i}
          className={cn('min-w-[2px] flex-1 rounded-full', color)}
          style={{ height: `${Math.round(Math.max(BAR_FLOOR, hgt) * 100)}%` }}
        />
      ))}
    </div>
  )

  return (
    <div className="flex max-w-full items-center gap-2 py-0.5">
      <audio ref={audioRef} src={url} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t('pause') : t('play')}
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
          onClick={seek}
          role="presentation"
          className="relative cursor-pointer"
          style={{ width: waveWidth, maxWidth: '100%' }}
        >
          {barRow(rest)}
          {/* Проигранная часть — та же волна поверх, обрезанная по текущему месту. */}
          <div
            ref={overlayRef}
            className="absolute inset-0"
            style={{ clipPath: `inset(0 ${100 - staticProgress}% 0 0)` }}
            aria-hidden
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
      {/* Скорость — только у начатого голосового (и длинной записи), справа, как в Telegram:
          короткая песня играет на обычной скорости (lib/audio-player). */}
      {isCurrent &&
        (playing || current > 0) &&
        ((meta?.voice ?? true) || (player.duration || duration) >= LONG_AUDIO_SEC) && (
          <VoiceRateButton tone={mine ? 'onPrimary' : 'default'} className="self-start" />
        )}
    </div>
  )
}
