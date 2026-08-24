'use client'

import { useEffect, useState } from 'react'

// Одна точка правды про prefers-reduced-motion для графиков: recharts решает
// анимировать или нет по пропу, а не по CSS, поэтому медиа-запрос приходится
// читать из JS. Подписываемся на изменение — настройку меняют, не перезагружая
// страницу, и график должен перестать двигаться сразу.
const QUERY = '(prefers-reduced-motion: reduce)'

function matches(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia(QUERY).matches
}

export function useReducedMotion(): boolean {
  // Значение читаем сразу, а не в эффекте: иначе первый кадр графика успевает
  // проиграть анимацию входа, и настройка срабатывает только со второго рендера.
  const [reduced, setReduced] = useState(matches)

  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(QUERY)
    setReduced(mq.matches)
    const onChange = (e: MediaQueryListEvent): void => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return reduced
}
