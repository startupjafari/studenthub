'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslations } from 'next-intl'
import {
  Maximize2,
  Minimize2,
  Pause,
  PictureInPicture2,
  Play,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { cn } from '../lib'

// Видеоплеер платформы: свои контролы вместо системных, в раскладке Telegram — тонкая
// полоса прогресса во всю ширину кадра, под ней слева пауза, звук и время «0:04 / 1:33»,
// справа скорость, «картинка в картинке» и полный экран.
//
// `playsInline` — главное: без него iOS на первом же `play()` забирает видео в собственный
// полноэкранный плеер, и пользователь оказывается в интерфейсе телефона, а не приложения.
//
// Панель лежит на самом кадре, а не на всей области просмотра: у вертикального видео
// она иначе висела бы в пустоте под ним. Рамка кадра считается по пропорциям видео через
// единицы контейнера (`cqw`/`cqh`) — без замеров в JS и без скачка на ресайзе.
//
// Панель показывается при движении мыши и прячется сама, пока видео играет; на паузе
// остаётся. Разметка контролов помечена `data-gesture-skip`: жесты просмотрщика (листание,
// зум) на ней не начинаются, иначе перемотка превращалась бы в листание.

/** Через сколько бездействия прячем панель во время воспроизведения. */
const HIDE_AFTER_MS = 2500
/** Шаг перемотки с клавиатуры. */
const SEEK_STEP_SEC = 5
/** Шаг громкости с клавиатуры. */
const VOLUME_STEP = 0.1
/** Скорости по кругу, как в Telegram: кнопка переключает на следующую. */
const RATES = [1, 1.5, 2, 0.5] as const

function mmss(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Доля 0…1 по горизонтали внутри элемента. */
function ratioAt(el: HTMLElement, clientX: number): number {
  const r = el.getBoundingClientRect()
  return r.width > 0 ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0
}

/** Ползунок перетаскиванием: захват указателя, чтобы тянуть можно было и за пределами полосы. */
function dragHandlers(onRatio: (ratio: number) => void, onDrag?: (dragging: boolean) => void) {
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      onDrag?.(true)
      onRatio(ratioAt(e.currentTarget, e.clientX))
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        onRatio(ratioAt(e.currentTarget, e.clientX))
      }
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      onDrag?.(false)
    },
  }
}

const iconButton =
  'flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-white/90 transition-colors hover:text-white'

export function VideoPlayer({
  src,
  autoPlay = false,
  className,
  videoClassName,
  videoStyle,
  controlsHidden = false,
  onVideoRef,
  onLoadedMetadata,
}: {
  src: string
  autoPlay?: boolean
  className?: string
  videoClassName?: string
  /** Трансформация самого кадра (поворот, вписывание) — панель контролов не трогает. */
  videoStyle?: CSSProperties
  /**
   * Спрятать панель совсем — и при наведении тоже. Нужно повёрнутому кадру: панель
   * осталась бы горизонтальной поверх повёрнутой картинки и перекрывала бы её. Видео при
   * этом продолжает играть; на паузе остаётся только кнопка «играть» по центру.
   */
  controlsHidden?: boolean
  onVideoRef?: (el: HTMLVideoElement | null) => void
  onLoadedMetadata?: () => void
}) {
  const t = useTranslations('Common')
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [rate, setRate] = useState<number>(1)
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [aspect, setAspect] = useState<number | null>(null)
  const [visible, setVisible] = useState(true)
  const [scrubbing, setScrubbing] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [pipSupported, setPipSupported] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const playedRef = useRef<HTMLDivElement | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Каким указателем нажали на кадр: мышью клик ставит на паузу (как в Telegram), пальцем —
  // зовёт или прячет панель, иначе на телефоне видео замирало бы от каждого касания.
  const pointerType = useRef<string>('mouse')

  const attach = useCallback(
    (el: HTMLVideoElement | null): void => {
      setVideo(el)
      onVideoRef?.(el)
    },
    [onVideoRef],
  )

  useEffect(() => {
    setPipSupported(typeof document !== 'undefined' && document.pictureInPictureEnabled === true)
    const onFs = (): void => setFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  useEffect(() => {
    if (!video) return
    const onMeta = (): void => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0)
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setAspect(video.videoWidth / video.videoHeight)
      }
      onLoadedMetadata?.()
    }
    const onTime = (): void => setCurrent(video.currentTime)
    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => setPlaying(false)
    const onVolume = (): void => {
      setMuted(video.muted)
      setVolume(video.volume)
    }
    const onRate = (): void => setRate(video.playbackRate)
    const onProgress = (): void => {
      const dur = video.duration
      const ranges = video.buffered
      if (!Number.isFinite(dur) || dur <= 0 || ranges.length === 0) return
      setBuffered(Math.min(1, ranges.end(ranges.length - 1) / dur))
    }
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('durationchange', onMeta)
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onPause)
    video.addEventListener('volumechange', onVolume)
    video.addEventListener('ratechange', onRate)
    video.addEventListener('progress', onProgress)
    return () => {
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('durationchange', onMeta)
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onPause)
      video.removeEventListener('volumechange', onVolume)
      video.removeEventListener('ratechange', onRate)
      video.removeEventListener('progress', onProgress)
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

  const seekRatio = useCallback(
    (ratio: number): void => {
      if (!video) return
      const dur = video.duration
      if (!Number.isFinite(dur) || dur <= 0) return
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

  const setVolumeRatio = useCallback(
    (ratio: number): void => {
      if (!video) return
      video.volume = ratio
      // Потянули громкость вверх — звук включается, до нуля — выключается, как в Telegram.
      video.muted = ratio === 0
    },
    [video],
  )

  const toggleFullscreen = useCallback((): void => {
    const root = rootRef.current
    if (!root) return
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
    } else if (root.requestFullscreen) {
      void root.requestFullscreen().catch(() => undefined)
    } else {
      // iOS Safari не умеет полноэкранный режим для div — только для самого видео.
      const legacy = video as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
      legacy?.webkitEnterFullscreen?.()
    }
  }, [video])

  const togglePip = useCallback((): void => {
    if (!video) return
    if (document.pictureInPictureElement) {
      void document.exitPictureInPicture().catch(() => undefined)
    } else {
      void video.requestPictureInPicture().catch(() => undefined)
    }
  }, [video])

  const progress = duration > 0 ? Math.min(100, (current / duration) * 100) : 0
  const shown = visible && !controlsHidden
  const volumeLevel = muted ? 0 : volume
  const VolumeIcon = volumeLevel === 0 ? VolumeX : volumeLevel < 0.5 ? Volume1 : Volume2

  // Рамка по пропорциям видео: вписана в область, как `object-contain`, но это настоящий
  // блок — на нём и лежит панель. До метаданных пропорций нет — рамка во всю область.
  const frameStyle: CSSProperties = aspect
    ? { width: `min(100cqw, 100cqh * ${aspect})`, aspectRatio: String(aspect) }
    : { width: '100%', height: '100%' }

  return (
    <div
      ref={rootRef}
      style={{ containerType: 'size' }}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') keepVisible()
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse' && playing && !scrubbing) setVisible(false)
      }}
      className={cn(
        'relative flex h-full w-full items-center justify-center',
        fullscreen && 'bg-black',
        // Мышь без движения во время воспроизведения прячется вместе с панелью. У кадра без
        // панели (повёрнут) прятать нечего — курсор остаётся.
        !visible && !controlsHidden && playing && 'cursor-none',
        className,
      )}
    >
      <div className="relative" style={frameStyle}>
        <video
          ref={attach}
          src={src}
          autoPlay={autoPlay}
          playsInline
          preload="metadata"
          className={cn('size-full object-contain', videoClassName)}
          style={videoStyle}
          onPointerDown={(e) => {
            pointerType.current = e.pointerType
          }}
          onClick={(e) => {
            // Клик по кадру не закрывает просмотрщик.
            e.stopPropagation()
            if (pointerType.current === 'mouse') toggle()
            else if (visible && playing) setVisible(false)
            else keepVisible()
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            toggleFullscreen()
          }}
        />

        {/* Крупная кнопка по центру — пока видео стоит, играть его главное действие.
            Остаётся и у повёрнутого кадра: без панели это единственный способ продолжить. */}
        {!playing && (
          <button
            type="button"
            data-gesture-skip="true"
            aria-label={t('play')}
            onClick={(e) => {
              e.stopPropagation()
              toggle()
            }}
            className="absolute top-1/2 left-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
          >
            <Play className="size-8 translate-x-0.5 fill-current" aria-hidden />
          </button>
        )}

        <div
          data-gesture-skip="true"
          onClick={(e) => e.stopPropagation()}
          aria-hidden={!shown}
          className={cn(
            'absolute inset-x-0 bottom-0 flex flex-col bg-gradient-to-t from-black/75 via-black/35 to-transparent px-3 pt-10 pb-1.5 text-white transition-opacity duration-200',
            shown ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          {/* Полоса прогресса во всю ширину: сыгранное — акцентом, загруженное — светлее.
              Зона нажатия выше самой полосы, при наведении полоса толще и видна ручка. */}
          <div
            role="slider"
            tabIndex={shown ? 0 : -1}
            aria-label={t('seek')}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(current)}
            aria-valuetext={`${mmss(current)} / ${mmss(duration)}`}
            {...dragHandlers(seekRatio, setScrubbing)}
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
            className="group/seek flex cursor-pointer touch-none items-center py-2 outline-none"
          >
            <div className="relative h-1 w-full rounded-full bg-white/25 transition-[height] group-hover/seek:h-1.5 group-focus-visible/seek:h-1.5">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white/35"
                style={{ width: `${buffered * 100}%` }}
              />
              <div
                ref={playedRef}
                className="absolute inset-y-0 left-0 rounded-full bg-primary"
                style={{ width: `${progress}%` }}
              >
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-1/2 -right-1.5 size-3 -translate-y-1/2 rounded-full bg-primary opacity-0 shadow transition-opacity group-hover/seek:opacity-100 group-focus-visible/seek:opacity-100',
                    scrubbing && 'opacity-100',
                  )}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              tabIndex={shown ? 0 : -1}
              aria-label={playing ? t('pause') : t('play')}
              onClick={toggle}
              className={iconButton}
            >
              {playing ? (
                <Pause className="size-5 fill-current" aria-hidden />
              ) : (
                <Play className="size-5 translate-x-px fill-current" aria-hidden />
              )}
            </button>

            {/* Звук: кнопка выключает, а регулятор выезжает при наведении — как в Telegram. */}
            <div className="group/vol flex items-center">
              <button
                type="button"
                tabIndex={shown ? 0 : -1}
                aria-label={muted ? t('unmute') : t('mute')}
                onClick={() => {
                  if (!video) return
                  video.muted = !video.muted
                  // Включили звук, а громкость стояла на нуле — иначе кнопка ничего бы не дала.
                  if (!video.muted && video.volume === 0) video.volume = 1
                  keepVisible()
                }}
                className={iconButton}
              >
                <VolumeIcon className="size-5" aria-hidden />
              </button>
              <div
                role="slider"
                tabIndex={shown ? 0 : -1}
                aria-label={t('volume')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(volumeLevel * 100)}
                {...dragHandlers(setVolumeRatio)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.stopPropagation()
                    e.preventDefault()
                    const delta = e.key === 'ArrowLeft' ? -VOLUME_STEP : VOLUME_STEP
                    setVolumeRatio(Math.min(1, Math.max(0, volumeLevel + delta)))
                  }
                }}
                className="flex w-0 cursor-pointer touch-none items-center overflow-hidden py-2 opacity-0 transition-all duration-200 outline-none group-hover/vol:mx-1 group-hover/vol:w-16 group-hover/vol:opacity-100 focus-visible:mx-1 focus-visible:w-16 focus-visible:opacity-100"
              >
                <div className="relative h-1 w-full rounded-full bg-white/25">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-white"
                    style={{ width: `${volumeLevel * 100}%` }}
                  />
                </div>
              </div>
            </div>

            <span className="ml-1 shrink-0 text-xs text-white/90 tabular-nums">
              {mmss(current)} / {mmss(duration)}
            </span>

            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                tabIndex={shown ? 0 : -1}
                aria-label={t('speed')}
                title={t('speed')}
                onClick={() => {
                  if (!video) return
                  const i = RATES.indexOf(rate as (typeof RATES)[number])
                  video.playbackRate = RATES[(i + 1) % RATES.length] ?? 1
                  keepVisible()
                }}
                className={cn(iconButton, 'w-auto px-1')}
              >
                <span className="rounded border-[1.5px] border-current px-1 text-[11px] leading-4 font-bold tabular-nums">
                  {rate}X
                </span>
              </button>
              {pipSupported && (
                <button
                  type="button"
                  tabIndex={shown ? 0 : -1}
                  aria-label={t('pip')}
                  title={t('pip')}
                  onClick={togglePip}
                  className={iconButton}
                >
                  <PictureInPicture2 className="size-5" aria-hidden />
                </button>
              )}
              <button
                type="button"
                tabIndex={shown ? 0 : -1}
                aria-label={fullscreen ? t('exitFullscreen') : t('fullscreen')}
                title={fullscreen ? t('exitFullscreen') : t('fullscreen')}
                onClick={toggleFullscreen}
                className={iconButton}
              >
                {fullscreen ? (
                  <Minimize2 className="size-5" aria-hidden />
                ) : (
                  <Maximize2 className="size-5" aria-hidden />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
