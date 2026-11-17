'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import {
  closeAudio,
  getAudioElement,
  LONG_AUDIO_SEC,
  nudgeAudio,
  playNeighbour,
  retainAudioPlayer,
  seekAudioRatio,
  setAudioVolume,
  toggleAudio,
  toggleAudioMuted,
  toggleAudioRepeat,
  toggleAudioShuffle,
  useAudioPlayer,
  useAudioQueue,
  useAudioSettings,
  VoiceRateButton,
  type ChatMessage,
} from '../../../entities/chat'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { senderName } from '../lib/format'

/** Шаг перемотки стрелками по полосе — как у видеоплеера. */
const SEEK_STEP_SEC = 5

const ICON_BTN =
  'flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40'

function mmss(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Шаг громкости стрелками по регулятору. */
const VOLUME_STEP = 0.1

/**
 * Панель аудиоплеера под шапкой чата (как в Telegram): что играет, ◀ ▶ по голосовым и
 * музыке чата, пауза, закрыть. У голосового — скорость 1× / 1,5× / 2×; у музыки —
 * громкость (запоминается), повтор и перемешивание, скорость — только у длинных записей. Тонкая полоса снизу — прогресс и
 * перемотка. Видна, пока что-то играет — в том числе голосовое из другого чата: нажатие на
 * заголовок ведёт к его сообщению.
 *
 * Сам звук живёт в общем плеере (entities/chat/lib/audio-player): панель только показывает
 * его и отдаёт ему очередь открытого чата.
 */
export function AudioPlayerBar({
  chatId,
  messages,
  onFocusMessage,
}: {
  chatId: string | null
  /** Загруженная история открытого чата — из неё очередь голосовых и музыки. */
  messages: readonly ChatMessage[] | undefined
  /** Прокрутить открытый чат к сообщению (focusMessage окна чата). */
  onFocusMessage: (messageId: string) => void
}) {
  const t = useTranslations('Chats')
  const tCommon = useTranslations('Common')
  const router = useRouter()
  const pathname = usePathname()
  const player = useAudioPlayer()
  const track = player.track
  const [current, setCurrent] = useState(0)
  const playedRef = useRef<HTMLSpanElement | null>(null)

  useAudioQueue(chatId, messages, senderName)

  // Пока панель на экране, звук «кому-то показан»: уйдём из чатов — он остановится сам.
  useEffect(() => retainAudioPlayer(), [])

  // Время в подписи — по событиям элемента (четыре раза в секунду хватает цифрам).
  useEffect(() => {
    const a = getAudioElement()
    if (!a || !track) return
    const onTime = (): void => setCurrent(Number.isFinite(a.currentTime) ? a.currentTime : 0)
    onTime()
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('seeked', onTime)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('seeked', onTime)
    }
  }, [track])

  // Полоса — каждый кадр и прямо в DOM: по timeupdate она ползла бы ступеньками.
  const duration = player.duration
  useEffect(() => {
    const bar = playedRef.current
    const a = getAudioElement()
    if (!bar || !a) return
    const paint = (): void => {
      const d = duration > 0 ? duration : 0
      bar.style.width = d ? `${Math.min(100, (a.currentTime / d) * 100)}%` : '0%'
    }
    paint()
    if (!player.playing) return
    let frame = requestAnimationFrame(function loop() {
      paint()
      frame = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(frame)
  }, [player.playing, duration, track])

  if (!track) return null

  const goTo = (): void => {
    if (track.chatId && track.messageId) {
      if (track.chatId === chatId) onFocusMessage(track.messageId)
      // Голосовое из другого чата — открываем тот чат на этом сообщении (deeplink окна).
      else router.push(`${pathname}?c=${track.chatId}&m=${track.messageId}`)
      return
    }
    track.onGoTo?.()
  }

  const subtitle = track.voice
    ? `${mmss(current)} · ${t('tgMedia.voiceMessage')}`
    : [`${mmss(current)} / ${mmss(duration)}`, track.performer].filter(Boolean).join(' · ')

  return (
    <div
      role="region"
      aria-label={t('tgMedia.player')}
      className="relative flex h-12 shrink-0 items-center gap-0.5 border-b border-border bg-background px-1.5 duration-(--motion-menu) animate-in fade-in-0 slide-in-from-top-1 sm:px-2"
    >
      <button
        type="button"
        aria-label={t('tgMedia.previous')}
        title={t('tgMedia.previous')}
        disabled={!player.hasPrev}
        onClick={() => playNeighbour(-1)}
        className={cn(ICON_BTN, 'hidden sm:flex')}
      >
        <SkipBack className="size-4 fill-current" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={player.playing ? t('pause') : t('play')}
        onClick={toggleAudio}
        className={cn(ICON_BTN, 'text-primary hover:text-primary')}
      >
        {player.loading && !player.playing ? (
          <Loader2 className="size-5 animate-spin" aria-hidden />
        ) : player.playing ? (
          <Pause className="size-5 fill-current" aria-hidden />
        ) : (
          <Play className="size-5 translate-x-px fill-current" aria-hidden />
        )}
      </button>
      <button
        type="button"
        aria-label={t('tgMedia.next')}
        title={t('tgMedia.next')}
        disabled={!player.hasNext}
        onClick={() => playNeighbour(1)}
        className={cn(ICON_BTN, 'hidden sm:flex')}
      >
        <SkipForward className="size-4 fill-current" aria-hidden />
      </button>

      {/* Что играет: нажатие ведёт к сообщению — как заголовок плеера в Telegram. */}
      <button
        type="button"
        onClick={goTo}
        title={t('goToMessage')}
        className="flex min-w-0 flex-1 flex-col justify-center self-stretch rounded-lg px-2 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <span className="truncate text-sm leading-tight font-medium">{track.title}</span>
        <span className="truncate text-xs leading-tight text-muted-foreground tabular-nums">
          {subtitle}
        </span>
      </button>

      {!track.voice && <VolumeControl />}
      {!track.voice && <PlaybackOrderMenu />}
      {(track.voice || duration >= LONG_AUDIO_SEC) && <VoiceRateButton className="mx-1" />}
      <button
        type="button"
        aria-label={t('tgMedia.closePlayer')}
        title={t('tgMedia.closePlayer')}
        onClick={closeAudio}
        className={ICON_BTN}
      >
        <X className="size-4" aria-hidden />
      </button>

      {/* Полоса прогресса и перемотки по нижнему краю панели. Зона нажатия выше самой
          полосы, при наведении и фокусе полоса толще. */}
      <div
        role="slider"
        tabIndex={0}
        aria-label={tCommon('seek')}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(current)}
        aria-valuetext={`${mmss(current)} / ${mmss(duration)}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          const r = e.currentTarget.getBoundingClientRect()
          seekAudioRatio((e.clientX - r.left) / r.width)
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
          const r = e.currentTarget.getBoundingClientRect()
          seekAudioRatio((e.clientX - r.left) / r.width)
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault()
            nudgeAudio(e.key === 'ArrowLeft' ? -SEEK_STEP_SEC : SEEK_STEP_SEC)
          } else if (e.key === 'Home') {
            e.preventDefault()
            seekAudioRatio(0)
          } else if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault()
            toggleAudio()
          }
        }}
        className="group/seek absolute inset-x-0 -bottom-px flex h-2 cursor-pointer touch-none items-end outline-none"
      >
        <span className="relative block h-0.5 w-full bg-primary/15 transition-[height] group-hover/seek:h-1 group-focus-visible/seek:h-1">
          <span ref={playedRef} className="absolute inset-y-0 left-0 bg-primary" />
        </span>
      </div>
    </div>
  )
}

/**
 * Громкость музыки: кнопка выключает звук, регулятор выезжает при наведении и фокусе — как в
 * Telegram и в нашем видеоплеере. На телефоне регулятора нет: там громкость — кнопками
 * устройства, а место в панели нужнее названию трека.
 */
function VolumeControl() {
  const tCommon = useTranslations('Common')
  const t = useTranslations('Chats')
  const { volume, muted } = useAudioSettings()
  const level = muted ? 0 : volume
  const Icon = level === 0 ? VolumeX : level < 0.5 ? Volume1 : Volume2
  const setFrom = (el: HTMLElement, clientX: number): void => {
    const r = el.getBoundingClientRect()
    if (r.width > 0) setAudioVolume((clientX - r.left) / r.width)
  }
  return (
    <div className="group/vol hidden items-center sm:flex">
      <button
        type="button"
        aria-label={muted ? tCommon('unmute') : tCommon('mute')}
        title={muted ? tCommon('unmute') : tCommon('mute')}
        onClick={toggleAudioMuted}
        className={ICON_BTN}
      >
        <Icon className="size-4" aria-hidden />
      </button>
      <div
        role="slider"
        tabIndex={0}
        aria-label={t('tgMedia2.volume')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
        aria-valuetext={`${Math.round(level * 100)}%`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setFrom(e.currentTarget, e.clientX)
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) setFrom(e.currentTarget, e.clientX)
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault()
            setAudioVolume(level - VOLUME_STEP)
          } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault()
            setAudioVolume(level + VOLUME_STEP)
          }
        }}
        className="flex w-0 cursor-pointer touch-none items-center overflow-hidden py-2 opacity-0 transition-all duration-(--motion-micro) outline-none group-hover/vol:mr-1 group-hover/vol:w-16 group-hover/vol:opacity-100 focus-visible:mr-1 focus-visible:w-16 focus-visible:opacity-100 motion-reduce:transition-none"
      >
        <span className="relative block h-1 w-full rounded-full bg-primary/15">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-primary"
            style={{ width: `${level * 100}%` }}
          />
        </span>
      </div>
    </div>
  )
}

/**
 * Порядок воспроизведения музыки — меню, как в Telegram: перемешать, повторять все,
 * повторять трек. Значок показывает выбранный режим и подсвечен, если он не обычный.
 */
function PlaybackOrderMenu() {
  const t = useTranslations('Chats')
  const { repeat, shuffle } = useAudioSettings()
  const Icon = shuffle ? Shuffle : repeat === 'one' ? Repeat1 : Repeat
  const applied = shuffle || repeat !== 'none'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('tgMedia2.playbackOrder')}
          title={t('tgMedia2.playbackOrder')}
          className={cn(ICON_BTN, applied && 'text-primary hover:text-primary')}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuCheckboxItem checked={shuffle} onCheckedChange={toggleAudioShuffle}>
          <Shuffle aria-hidden />
          {t('tgMedia2.shuffle')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={repeat === 'all'}
          onCheckedChange={() => toggleAudioRepeat('all')}
        >
          <Repeat aria-hidden />
          {t('tgMedia2.repeatAll')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={repeat === 'one'}
          onCheckedChange={() => toggleAudioRepeat('one')}
        >
          <Repeat1 aria-hidden />
          {t('tgMedia2.repeatOne')}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
