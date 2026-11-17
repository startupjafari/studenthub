'use client'

import { useSyncExternalStore } from 'react'

/**
 * Настройки аудиоплеера чатов для музыки (как в Telegram): громкость, повтор и перемешивание.
 * Одни на всё приложение и запоминаются в localStorage этого браузера — удобство зрителя, а
 * не данные. Голосовых они не касаются: у записи с микрофона только скорость (voice-rate).
 */
export type AudioRepeat = 'none' | 'all' | 'one'

export interface AudioSettings {
  /** 0…1. */
  volume: number
  muted: boolean
  /** `all` — по кругу весь список, `one` — один трек. */
  repeat: AudioRepeat
  shuffle: boolean
}

const KEY = 'studenthub:audio-player'
const DEFAULTS: AudioSettings = { volume: 1, muted: false, repeat: 'none', shuffle: false }

function clampVolume(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.NaN
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1
}

function read(): AudioSettings {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const v = JSON.parse(raw) as Partial<AudioSettings>
    return {
      volume: clampVolume(v.volume),
      muted: v.muted === true,
      repeat: v.repeat === 'all' || v.repeat === 'one' ? v.repeat : 'none',
      shuffle: v.shuffle === true,
    }
  } catch {
    return DEFAULTS
  }
}

let settings: AudioSettings | null = null
const listeners = new Set<() => void>()

export function getAudioSettings(): AudioSettings {
  if (settings === null) settings = typeof window === 'undefined' ? DEFAULTS : read()
  return settings
}

function update(next: Partial<AudioSettings>): void {
  settings = { ...getAudioSettings(), ...next }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Хранилище недоступно (приватный режим) — настройки держатся до перезагрузки.
  }
  for (const fn of listeners) fn()
}

/** Громкость 0…1. Сдвинули регулятор со звуком «выключен» — звук включается. */
export function setAudioVolume(volume: number): void {
  const v = clampVolume(volume)
  update({ volume: v, muted: v === 0 })
}

/** Выключить или вернуть звук. Включили на нулевой громкости — сразу на полную. */
export function toggleAudioMuted(): void {
  const cur = getAudioSettings()
  if (cur.muted || cur.volume === 0) update({ muted: false, volume: cur.volume || 1 })
  else update({ muted: true })
}

/** Повтор: тот же режим ещё раз — выключить (как пункты меню Telegram). */
export function toggleAudioRepeat(mode: Exclude<AudioRepeat, 'none'>): void {
  update({ repeat: getAudioSettings().repeat === mode ? 'none' : mode })
}

export function toggleAudioShuffle(): void {
  update({ shuffle: !getAudioSettings().shuffle })
}

/** Подписка вне React: общий плеер подхватывает громкость и повтор прямо на играющем. */
export function subscribeAudioSettings(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function useAudioSettings(): AudioSettings {
  return useSyncExternalStore(subscribeAudioSettings, getAudioSettings, () => DEFAULTS)
}
