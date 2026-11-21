'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Подъехал ли блок к окну прокрутки (с запасом `margin`) и задержался ли там на `settleMs`.
 * Так панель стикеров догружает набор, только когда до него долистали, как Telegram.
 *
 * Задержка нужна для перехода по обложке: плавная прокрутка к сотому набору пролетает мимо
 * всех промежуточных, и без неё каждый из них ушёл бы в сеть. Флаг залипающий: прокрутка
 * обратно не прячет уже загруженный набор и не запрашивает его заново.
 *
 * Наблюдатель ставится в эффекте, а не в ref-колбэке: ref детей React привязывает раньше,
 * чем ref контейнера, и в колбэке окно прокрутки было бы ещё пустым.
 */
export function useNearView<T extends Element>(
  rootRef: RefObject<Element | null>,
  { margin = '300px 0px', settleMs = 150 }: { margin?: string; settleMs?: number } = {},
): { ref: RefObject<T | null>; near: boolean } {
  const ref = useRef<T | null>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (near || !node) return
    // Без IntersectionObserver (старые браузеры, jsdom) показываем сразу: лучше лишний
    // запрос, чем набор, который никогда не загрузится.
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const stop = (): void => {
      if (timer) clearTimeout(timer)
      timer = null
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting)
        if (!visible) return stop()
        if (timer) return
        timer = setTimeout(() => setNear(true), settleMs)
      },
      { root: rootRef.current, rootMargin: margin },
    )
    observer.observe(node)
    return () => {
      stop()
      observer.disconnect()
    }
  }, [near, rootRef, margin, settleMs])

  return { ref, near }
}
