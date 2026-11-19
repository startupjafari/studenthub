'use client'

import { useEffect, useRef, useState } from 'react'

// Какие элементы списка только что появились (пришли по сокету или после перечитывания) —
// их подсвечивают классом `sh-live-in`: въезд и короткая подсветка, чтобы новое было видно
// глазом, а не угадывалось по сдвигу списка. Первый показ списка — не «новое»: иначе при
// каждом открытии экрана мигали бы все строки.

/** Сколько держится отметка «новый» — столько же, сколько идёт подсветка в CSS. */
const FRESH_MS = 1600

export function useFreshIds(ids: readonly string[] | undefined): ReadonlySet<string> {
  const known = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    if (!ids) return
    // Первый непустой список — точка отсчёта, ничего не подсвечиваем.
    if (known.current === null) {
      known.current = new Set(ids)
      return
    }
    const added = ids.filter((id) => !known.current!.has(id))
    for (const id of ids) known.current.add(id)
    if (added.length === 0) return
    setFresh((prev) => new Set([...prev, ...added]))
    const timer = window.setTimeout(() => {
      setFresh((prev) => {
        const next = new Set(prev)
        for (const id of added) next.delete(id)
        return next
      })
    }, FRESH_MS)
    return () => window.clearTimeout(timer)
  }, [ids])

  return fresh
}
