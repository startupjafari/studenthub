'use client'

import { useCallback, useEffect, useState } from 'react'
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

/** Ключи переключателей в localStorage. Как у темы (next-themes), той же природы настройки. */
const SEASON_STORAGE_KEY = 'sh-season-decor'

/**
 * Движение — отдельная настройка и по умолчанию ВЫКЛЮЧЕНА, в отличие от палитры.
 * Цвет акцента человек видит краем глаза, падающие частицы — тянут взгляд на себя, и
 * согласие на первое не означает согласия на второе.
 */
const SEASON_MOTION_KEY = 'sh-season-motion'

/** Сыгранное движение: `<праздник>:<дата>`. Частицы идут один раз в день, а не при каждом заходе. */
const SEASON_PLAYED_KEY = 'sh-season-played'

/** Событие для своей же вкладки: `storage` браузер шлёт только остальным. */
const SEASON_EVENT = 'sh-season-change'

/**
 * Закрытое поздравление: `<праздник>:<год>`. Именно год, а не дата, — закрыв поздравление
 * в первый день Наурыза, человек не должен увидеть его снова на второй и третий.
 */
const SEASON_DISMISS_KEY = 'sh-season-dismissed'

/** Пересчёт не реже, чем раз в 6 часов, даже если полночь далеко: часы и таймзона могут съехать. */
const MAX_RECHECK_MS = 6 * 60 * 60 * 1000

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key)
    if (value === 'on') return true
    if (value === 'off') return false
    return fallback
  } catch {
    // Приватный режим и заблокированные site data: оформление — не то, ради чего стоит падать.
    return fallback
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? 'on' : 'off')
  } catch {
    // Настройка не сохранится, но текущая вкладка обязана отреагировать — событие ниже.
  }
  window.dispatchEvent(new Event(SEASON_EVENT))
}

const isSeasonEnabled = (): boolean => readFlag(SEASON_STORAGE_KEY, true)
const isSeasonMotionEnabled = (): boolean => readFlag(SEASON_MOTION_KEY, false)

/** Сколько миллисекунд до ближайшей полуночи в этой таймзоне (с запасом в минуту). */
function msUntilMidnight(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  const left = (24 * 60 - (hours * 60 + minutes)) * 60 * 1000 + 60_000
  return Math.min(left, MAX_RECHECK_MS)
}

/**
 * Праздник сегодняшнего дня и сама дата. До монтирования праздника нет: настройка лежит
 * в localStorage, на сервере её нет, и любой другой ответ означал бы расхождение гидрации
 * (а у выключившего оформление — вспышку поздравления на один кадр).
 */
function useSeasonDay(): { season: Holiday | null; date: string } {
  const timeZone = useTimeZone()
  const [day, setDay] = useState<{ season: Holiday | null; date: string }>({
    season: null,
    date: '',
  })

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const apply = () => {
      if (timer) clearTimeout(timer)
      const { date, time } = nowInTz(timeZone)
      setDay({ season: isSeasonEnabled() ? activeSeason(date) : null, date })
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

  return day
}

/**
 * Поздравление: тот же праздник, но закрываемый. Закрытие запоминается на весь праздник,
 * а не на день, и живёт в браузере: на сервере такому состоянию делать нечего.
 */
export function useSeasonGreeting(): {
  season: Holiday | null
  motion: boolean
  dismiss: () => void
} {
  const { season, date } = useSeasonDay()
  const mark = season ? `${season.id}:${date.slice(0, 4)}` : ''
  const [hidden, setHidden] = useState(true)
  const [motion, setMotion] = useState(false)

  useEffect(() => {
    if (!mark) {
      setHidden(true)
      return
    }
    try {
      setHidden(localStorage.getItem(SEASON_DISMISS_KEY) === mark)
    } catch {
      setHidden(false)
    }
  }, [mark])

  // Движение: своя настройка, свой признак «уже играли», и никогда — в сдержанные дни.
  // Отметка ставится в тот же момент, когда принято решение играть: иначе переход между
  // главными экранами запускал бы частицы заново.
  useEffect(() => {
    if (!season || hidden || season.tone === 'solemn' || !isSeasonMotionEnabled()) {
      setMotion(false)
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setMotion(false)
      return
    }
    const played = `${season.id}:${date}`
    try {
      if (localStorage.getItem(SEASON_PLAYED_KEY) === played) return
      localStorage.setItem(SEASON_PLAYED_KEY, played)
    } catch {
      // Без хранилища частицы сыграют на каждом открытии главной. Терпимо.
    }
    setMotion(true)
  }, [season, hidden, date])

  const dismiss = useCallback(() => {
    setHidden(true)
    try {
      localStorage.setItem(SEASON_DISMISS_KEY, mark)
    } catch {
      // Не сохранилось — поздравление вернётся завтра. Это не повод падать.
    }
  }, [mark])

  return { season: hidden ? null : season, motion: hidden ? false : motion, dismiss }
}

/**
 * Ставит `data-season` на <html>. Вызывается один раз на приложение (app/providers.tsx),
 * рядом с темой: дальше праздник живёт в CSS, и компонентам о нём знать не нужно.
 */
export function useSeasonTheme(): void {
  const { season } = useSeasonDay()

  useEffect(() => {
    const root = document.documentElement
    if (season) root.setAttribute('data-season', season.id)
    else root.removeAttribute('data-season')
  }, [season])
}

/** Состояние переключателя в настройках. `mounted` — гейт против расхождения гидрации. */
function useStoredFlag(
  key: string,
  fallback: boolean,
): { enabled: boolean; mounted: boolean; set: (v: boolean) => void } {
  const [enabled, setEnabled] = useState(fallback)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const sync = () => setEnabled(readFlag(key, fallback))
    sync()
    setMounted(true)
    window.addEventListener('storage', sync)
    window.addEventListener(SEASON_EVENT, sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(SEASON_EVENT, sync)
    }
  }, [key, fallback])

  const set = useCallback((value: boolean) => writeFlag(key, value), [key])

  return { enabled, mounted, set }
}

/** Праздничное оформление целиком: палитра и поздравление. По умолчанию включено. */
export function useSeasonEnabled() {
  return useStoredFlag(SEASON_STORAGE_KEY, true)
}

/** Праздничное движение. По умолчанию выключено — см. SEASON_MOTION_KEY. */
export function useSeasonMotionEnabled() {
  return useStoredFlag(SEASON_MOTION_KEY, false)
}
