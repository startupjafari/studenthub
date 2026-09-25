'use client'

import { useEffect, useState } from 'react'
import { useTimeZone } from 'next-intl'
import { activeSeason, type Holiday } from '../config/holidays'
import { nowInTz } from './tz-date'

/**
 * Праздничное оформление: активный праздник и атрибут `data-season` на <html>.
 *
 * Дата считается в таймзоне платформы (`i18n/request.ts` → `useTimeZone`), а не браузера:
 * у студента в поездке Наурыз обязан начаться тогда же, когда у его вуза.
 *
 * Праздник определяется В РАНТАЙМЕ и пересчитывается — не один раз при загрузке модуля.
 * Причина та же, что у окна «Что нового»: у приложения с домашнего экрана вкладка живёт
 * неделями, и значение, посчитанное при её открытии, к празднику успевает протухнуть.
 */

/** Ключ переключателя в localStorage. Как у темы (next-themes), той же природы настройка. */
export const SEASON_STORAGE_KEY = 'sh-season-decor'

/** Событие для своей же вкладки: `storage` браузер шлёт только остальным. */
const SEASON_EVENT = 'sh-season-change'

/** Пересчёт не реже, чем раз в 6 часов, даже если полночь далеко: часы и таймзона могут съехать. */
const MAX_RECHECK_MS = 6 * 60 * 60 * 1000

export function isSeasonEnabled(): boolean {
  try {
    return localStorage.getItem(SEASON_STORAGE_KEY) !== 'off'
  } catch {
    // Приватный режим и заблокированные site data: оформление — не то, ради чего стоит падать.
    return true
  }
}

export function setSeasonEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SEASON_STORAGE_KEY, enabled ? 'on' : 'off')
  } catch {
    // Настройка не сохранится, но текущая вкладка обязана отреагировать — событие ниже.
  }
  window.dispatchEvent(new Event(SEASON_EVENT))
}

/** Сколько миллисекунд до ближайшей полуночи в этой таймзоне (с запасом в минуту). */
function msUntilMidnight(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  const left = (24 * 60 - (hours * 60 + minutes)) * 60 * 1000 + 60_000
  return Math.min(left, MAX_RECHECK_MS)
}

/**
 * Праздник сегодняшнего дня или `null`. До монтирования — всегда `null`: настройка лежит
 * в localStorage, на сервере её нет, и любой другой ответ означал бы расхождение гидрации
 * (а у выключившего оформление — вспышку поздравления на один кадр).
 */
export function useActiveSeason(): Holiday | null {
  const timeZone = useTimeZone()
  const [season, setSeason] = useState<Holiday | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const apply = () => {
      if (timer) clearTimeout(timer)
      const { date, time } = nowInTz(timeZone)
      setSeason(isSeasonEnabled() ? activeSeason(date) : null)
      timer = setTimeout(apply, msUntilMidnight(time))
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') apply()
    }

    apply()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', apply)
    window.addEventListener('storage', apply)
    window.addEventListener(SEASON_EVENT, apply)

    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', apply)
      window.removeEventListener('storage', apply)
      window.removeEventListener(SEASON_EVENT, apply)
    }
  }, [timeZone])

  return season
}

/**
 * Ставит `data-season` на <html>. Вызывается один раз на приложение (app/providers.tsx),
 * рядом с темой: дальше праздник живёт в CSS, и компонентам о нём знать не нужно.
 */
export function useSeasonTheme(): void {
  const season = useActiveSeason()

  useEffect(() => {
    const root = document.documentElement
    if (season) root.setAttribute('data-season', season.id)
    else root.removeAttribute('data-season')
  }, [season])
}

/** Состояние переключателя в настройках. `mounted` — гейт против расхождения гидрации. */
export function useSeasonEnabled(): {
  enabled: boolean
  mounted: boolean
  set: (v: boolean) => void
} {
  const [enabled, setEnabled] = useState(true)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const sync = () => setEnabled(isSeasonEnabled())
    sync()
    setMounted(true)
    window.addEventListener('storage', sync)
    window.addEventListener(SEASON_EVENT, sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(SEASON_EVENT, sync)
    }
  }, [])

  return { enabled, mounted, set: setSeasonEnabled }
}
