'use client'

import { useEffect, useState } from 'react'

// Реактивный медиазапрос. На клиенте начальное значение читаем синхронно (ленивый инициализатор),
// чтобы первый же клиентский рендер имел верную ширину — иначе на десктопе мелькает раскладка
// «сайдбар виден, но embedded ещё false». На сервере window нет → false (страница чатов клиентская).
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const update = (): void => setMatches(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [query])

  return matches
}
