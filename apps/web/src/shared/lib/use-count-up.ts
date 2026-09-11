'use client'

import { useEffect, useRef, useState } from 'react'

// Плавный счёт от нуля до значения для плиток-показателей. Ощутимо оживляет
// дашборд, но это чистая декорация, поэтому:
//  · при prefers-reduced-motion значение ставится сразу, без анимации;
//  · анимация идёт на requestAnimationFrame, а не таймером на каждый шаг —
//    иначе пять плиток дают пять таймеров, дёргающих рендер вне кадра.

const DURATION_MS = 900

/** easeOutCubic: быстрый старт, мягкая остановка — число не «доезжает» рывком. */
function ease(t: number): number {
  return 1 - (1 - t) ** 3
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Возвращает значение, доезжающее до `target`. Дробные значения (медиана в часах)
 * сохраняют один знак после запятой — целочисленный счёт превратил бы 2.6 в 3.
 */
export function useCountUp(target: number, fractional = false): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0))
  const frame = useRef<number | null>(null)
  const from = useRef(0)

  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target)
      return
    }
    const start = performance.now()
    const initial = from.current
    const round = (v: number): number => (fractional ? Math.round(v * 10) / 10 : Math.round(v))

    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / DURATION_MS)
      setValue(round(initial + (target - initial) * ease(t)))
      if (t < 1) {
        frame.current = requestAnimationFrame(step)
      } else {
        from.current = target
        frame.current = null
      }
    }
    frame.current = requestAnimationFrame(step)

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      // Досчитываем мгновенно, если размонтировались на полпути: иначе следующий
      // показ плитки поехал бы с середины прошлой анимации.
      from.current = target
    }
  }, [target, fractional])

  return value
}
