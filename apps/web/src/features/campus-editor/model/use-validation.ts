'use client'

import { useEffect } from 'react'
import { validateFloor, type Problem } from '@studenthub/campus-core'
import type { EditorStore } from './store'

const DEBOUNCE_MS = 150

/**
 * Живая проверка этажа: после каждой правки документ уходит в воркер, ответ ложится в
 * `problems`. Без воркера (старый браузер, тест) — та же функция в главном потоке.
 */
export function useValidation(store: EditorStore): void {
  useEffect(() => {
    let worker: Worker | null = null
    try {
      worker = new Worker(new URL('./validate.worker.ts', import.meta.url))
    } catch {
      worker = null
    }
    let seq = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    if (worker) {
      worker.onmessage = (e: MessageEvent<{ seq: number; problems: Problem[] }>) => {
        if (e.data.seq === seq) store.set({ problems: e.data.problems })
      }
    }
    const run = (): void => {
      seq += 1
      const { doc, floorHeightMm } = store.getState()
      if (worker) worker.postMessage({ seq, doc, floorHeightMm })
      else store.set({ problems: validateFloor(doc, { floorHeightMm }) })
    }
    let last = store.getState().doc
    run()
    const unsubscribe = store.subscribe(() => {
      const doc = store.getState().doc
      if (doc === last) return
      last = doc
      if (timer) clearTimeout(timer)
      timer = setTimeout(run, DEBOUNCE_MS)
    })
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
      worker?.terminate()
    }
  }, [store])
}
