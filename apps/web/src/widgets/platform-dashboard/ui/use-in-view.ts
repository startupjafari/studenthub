'use client'

import { useEffect, useRef, useState } from 'react'

// Появился ли элемент в области видимости хотя бы раз. Нужно для двух вещей сразу:
// график ниже сгиба не монтирует полотно chart.js и не запрашивает данные, пока до
// него не долистали. На дашборде восемь графиков — без этого при открытии страницы
// создаётся восемь canvas и уходит восемь запросов, из которых видны один-два.
//
// Флаг «залипающий»: обратно в false не возвращается, иначе прокрутка вверх-вниз
// пересоздавала бы полотно и перезапрашивала данные.
export function useInView<T extends HTMLElement>(): {
  ref: (node: T | null) => void
  inView: boolean
} {
  const [inView, setInView] = useState(false)
  const observed = useRef<T | null>(null)
  const observer = useRef<IntersectionObserver | null>(null)

  useEffect(() => () => observer.current?.disconnect(), [])

  const ref = (node: T | null): void => {
    if (node === observed.current) return
    observed.current = node
    observer.current?.disconnect()
    if (!node) return
    // В окружении без IntersectionObserver (старые браузеры, jsdom в тестах)
    // показываем сразу: лучше лишний рендер, чем пустая страница.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    observer.current = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          observer.current?.disconnect()
        }
      },
      // Запускаем чуть заранее, чтобы к моменту доскролла данные уже пришли.
      { rootMargin: '200px' },
    )
    observer.current.observe(node)
  }

  return { ref, inView }
}
