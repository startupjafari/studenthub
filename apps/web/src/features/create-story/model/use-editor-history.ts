'use client'

import { useCallback, useRef, useState } from 'react'

/** Сколько шагов назад помнит редактор. */
const LIMIT = 100
/** Изменения с одним ключом чаще этого склеиваются в один шаг (перетаскивание, ползунок). */
const MERGE_MS = 800

interface History<T> {
  past: T[]
  present: T
  future: T[]
}

/**
 * История правок редактора для отмены и повтора. Каждое изменение — шаг, но серия
 * изменений с одним ключом (`move:<id>`, `scale:<id>`, набор текста) без пауз склеивается
 * в один: отмена возвращает элемент туда, откуда его потащили, а не на пиксель назад.
 */
export function useEditorHistory<T>(initial: T) {
  const [state, setState] = useState<History<T>>({ past: [], present: initial, future: [] })
  // Последний ключ и время — вне апдейтера: в StrictMode тот вызывается дважды, и решение
  // «склеить» из ref внутри него принималось бы по уже перезаписанному значению.
  const last = useRef<{ key: string; at: number } | null>(null)

  const apply = useCallback((update: (prev: T) => T, key?: string) => {
    const now = Date.now()
    const merge = key !== undefined && last.current?.key === key && now - last.current.at < MERGE_MS
    last.current = key === undefined ? null : { key, at: now }
    setState((s) => {
      const next = update(s.present)
      if (Object.is(next, s.present)) return s
      if (merge) return { ...s, present: next }
      return { past: [...s.past, s.present].slice(-LIMIT), present: next, future: [] }
    })
  }, [])

  const undo = useCallback(() => {
    last.current = null
    setState((s) =>
      s.past.length === 0
        ? s
        : {
            past: s.past.slice(0, -1),
            present: s.past[s.past.length - 1] as T,
            future: [s.present, ...s.future],
          },
    )
  }, [])

  const redo = useCallback(() => {
    last.current = null
    setState((s) =>
      s.future.length === 0
        ? s
        : { past: [...s.past, s.present], present: s.future[0] as T, future: s.future.slice(1) },
    )
  }, [])

  const reset = useCallback((value: T) => {
    last.current = null
    setState({ past: [], present: value, future: [] })
  }, [])

  return {
    present: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    apply,
    undo,
    redo,
    reset,
  }
}
