'use client'

import { useSyncExternalStore } from 'react'

/**
 * Скорость голосовых — одна на всё приложение и запоминается (как в Telegram): выбрали 1,5× —
 * следующее голосовое играет на 1,5×, вернули 1× — дальше снова 1×. Живёт в localStorage
 * этого браузера: это удобство зрителя, а не данные.
 */
export const VOICE_RATES = [1, 1.5, 2] as const
const KEY = 'studenthub:voice-rate'

function read(): number {
  try {
    const v = Number(window.localStorage.getItem(KEY))
    return (VOICE_RATES as readonly number[]).includes(v) ? v : 1
  } catch {
    return 1
  }
}

let rate: number | null = null
const listeners = new Set<() => void>()

export function getVoiceRate(): number {
  if (rate === null) rate = typeof window === 'undefined' ? 1 : read()
  return rate
}

/** Следующая скорость по кругу 1 → 1,5 → 2 → 1. */
export function cycleVoiceRate(): void {
  const cur = getVoiceRate()
  const i = VOICE_RATES.indexOf(cur as (typeof VOICE_RATES)[number])
  rate = VOICE_RATES[(i + 1) % VOICE_RATES.length]!
  try {
    window.localStorage.setItem(KEY, String(rate))
  } catch {
    // Хранилище недоступно (приватный режим) — скорость держится до перезагрузки.
  }
  for (const fn of listeners) fn()
}

export function useVoiceRate(): number {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    getVoiceRate,
    () => 1,
  )
}
