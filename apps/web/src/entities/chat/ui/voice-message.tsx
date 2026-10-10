'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Pause, Play } from 'lucide-react'
import { cn } from '../../../shared/lib/utils'
import { BAR_FLOOR, resampleEnvelope, useVoiceProfile, voiceBarCount } from '../lib/voice-profile'

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

// Единственное активное голосовое: старт нового ставит предыдущее на паузу (как в Telegram).
let activeAudio: HTMLAudioElement | null = null

/**
 * Голосовое сообщение в стиле Telegram (Ф9+): круглая кнопка play/pause, волна с плавной
 * заливкой прогресса, перемотка кликом, длительность. `mine` — тема на фоне пузыря.
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
}: {
  url: string
  seed: string
  mine: boolean
  /** Вес файла: по нему решаем, стоит ли вообще разбирать запись ради волны. */
  size: number
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef(0)
  const durationRef = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const voice = useVoiceProfile(url, seed, size)

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

  // webm от MediaRecorder часто без длительности — форсируем её вычисление.
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
      // Через seeked/durationchange (не timeupdate) — надёжнее: указатель не застревает, звук играет.
      //
      // Разбор записи длительность тоже даёт, но перемотку этим не починить: без досчитанной
      // длительности браузер в такой дорожке просто не умеет ставить указатель.
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
      if (overlayRef.current) overlayRef.current.style.clipPath = 'inset(0 100% 0 0)'
      if (activeAudio === audio) activeAudio = null
    }
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnd)
    return () => {
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnd)
      if (activeAudio === audio) activeAudio = null
    }
  }, [url])

  // Плавная заливка прогресса: обрезаем копию волны по кадрам, пока она играет. Обрезкой,
  // а не шириной: копия лежит во всю ширину волны и её полосы стоят ровно под своими.
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current)
      return
    }
    const loop = (): void => {
      const audio = audioRef.current
      const dur = durationRef.current
      if (audio && dur > 0 && overlayRef.current) {
        const done = Math.min(100, (audio.currentTime / dur) * 100)
        overlayRef.current.style.clipPath = `inset(0 ${100 - done}% 0 0)`
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing])

  function toggle(): void {
    const audio = audioRef.current
    if (!audio) return
    // Указатель мог «застрять» после форс-вычисления длительности (currentTime = 1e101) —
    // перед стартом возвращаем в начало (иначе play() «доигрывает» пустоту: ни звука, ни прогресса).
    if (audio.paused && (!Number.isFinite(audio.currentTime) || audio.currentTime > 1e6)) {
      try {
        audio.currentTime = 0
      } catch {
        /* игнорируем */
      }
    }
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
    </div>
  )
}
