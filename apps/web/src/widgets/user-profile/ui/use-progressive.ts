'use client'

import { useEffect, useState } from 'react'
import { useInfiniteScroll } from '../../../shared/lib'

/**
 * Поэтапный показ списка по прокрутке: сначала `step` элементов, следующая порция — когда
 * низ списка подходит к экрану (маячок `sentinelRef` ставится сразу под списком).
 *
 * `pending` — сколько скелетонов держать в хвосте: ровно на местах следующей порции. Плитки
 * мозаики берут форму от позиции, поэтому подгруженные встают точно на свои скелетоны, и
 * сетка не прыгает.
 *
 * `resetKey` — фильтр и сортировка: при их смене показ начинается с первой порции.
 */
export function useProgressive(total: number, step: number, resetKey: string) {
  const [count, setCount] = useState(step)
  // Один кадр «загрузки» после каждой порции: маячок, оставшийся в поле зрения, второй раз
  // не сработает (пересечение не менялось), а смена `loading` даёт хуку перепроверить его.
  const [loading, setLoading] = useState(false)

  useEffect(() => setCount(step), [resetKey, step])
  useEffect(() => {
    if (!loading) return
    const id = requestAnimationFrame(() => setLoading(false))
    return () => cancelAnimationFrame(id)
  }, [loading])

  const shown = Math.min(count, total)
  const sentinelRef = useInfiniteScroll<HTMLDivElement>({
    hasNext: shown < total,
    loading,
    onLoad: () => {
      setLoading(true)
      setCount((c) => c + step)
    },
  })
  return { shown, pending: Math.min(step, total - shown), sentinelRef }
}
