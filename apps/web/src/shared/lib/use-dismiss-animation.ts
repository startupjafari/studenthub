'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from './spring'

/**
 * Закрытие слоя с анимацией ухода.
 *
 * Появление слоям даётся даром (`animate-in` проигрывается при монтировании), а исчезновение —
 * нет: родитель снимает слой с рендера, и тот пропадает кадром, без всякого перехода. Глазу это
 * читается как сбой — только что на экране была панель, и вдруг её нет.
 *
 * Хук разводит два момента во времени: `dismiss()` сначала переводит слой в состояние `closing`
 * (на нём висят `animate-out`-классы), и лишь по истечении анимации зовёт `onClose` родителя.
 * Повторные вызовы игнорируются — иначе тап по пункту меню и тап по затемнению запустили бы
 * два таймера. При `prefers-reduced-motion` закрываем сразу: анимации ухода там просто нет.
 */
export function useDismissAnimation(
  onClose: () => void,
  ms = 150,
): { closing: boolean; dismiss: () => void } {
  const [closing, setClosing] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const dismiss = useCallback(() => {
    if (timer.current) return
    if (prefersReducedMotion()) {
      closeRef.current()
      return
    }
    setClosing(true)
    timer.current = setTimeout(() => closeRef.current(), ms)
  }, [ms])

  return { closing, dismiss }
}
