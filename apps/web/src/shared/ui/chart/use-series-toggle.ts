'use client'

import { useCallback, useState } from 'react'

/**
 * Состояние легенды: скрытые ряды (клик) и ряд под курсором (наведение).
 *
 * Две разные задачи, поэтому и два состояния: клик — насовсем убрать линию из
 * картины, наведение — на секунду выделить её среди остальных, не теряя контекст.
 * Интерактивность легенды обязательна для панели с несколькими рядами
 * (DESIGN_SYSTEM §12), поэтому хук живёт в системе, а не в одном дашборде.
 */
export function useSeriesToggle(): {
  hidden: Set<string>
  toggle: (key: string) => void
  focus: string | null
  setFocus: (key: string | null) => void
} {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [focus, setFocus] = useState<string | null>(null)
  const toggle = useCallback(
    (key: string): void =>
      setHidden((prev) => {
        const next = new Set(prev)
        if (!next.delete(key)) next.add(key)
        return next
      }),
    [],
  )
  return { hidden, toggle, focus, setFocus }
}
