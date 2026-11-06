'use client'

import { useEffect, useMemo, useState } from 'react'
import { nowInTz, type NowInTz } from './tz-date'

// Состояния пар («идёт», «прошла») меняются по минутам — сверяемся с часами чаще.
const TICK_MS = 30_000

/**
 * «Сейчас» в таймзоне вуза, которое идёт. `nowInTz` в `useMemo` застывал в момент открытия
 * экрана: открытый с утра дашборд к обеду показывал первую пару «идущей», а после полуночи —
 * вчерашний день и чётность.
 */
export function useNowInTz(timezone: string | null): NowInTz {
  const [at, setAt] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setAt(new Date()), TICK_MS)
    return () => clearInterval(timer)
  }, [])
  return useMemo(() => nowInTz(timezone, at), [timezone, at])
}
