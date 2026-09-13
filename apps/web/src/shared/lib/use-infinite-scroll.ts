'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * Подгрузка следующей страницы, когда до конца списка остаётся немного.
 *
 * Возвращает `ref` для маячка — пустого элемента в самом низу списка. Как только
 * маячок попадает в поле зрения (с запасом в `rootMargin`, чтобы страница успела
 * прийти ДО того, как читатель упрётся в дно), вызывается `onLoad`.
 *
 * Два места, где наивная реализация ломается:
 *
 * 1. Наблюдатель НЕ пересоздаётся на каждый рендер: `hasNext`, `loading` и `onLoad`
 *    живут в ref. Иначе `disconnect`/`observe` на каждой отрисовке ленты терял бы
 *    текущее пересечение, и подгрузка вставала бы до следующего движения колеса.
 * 2. После загрузки маячок может остаться в поле зрения (высокий экран, короткая
 *    страница). Второй раз IntersectionObserver не сработает — пересечение не
 *    менялось, — поэтому по окончании загрузки проверяем сами.
 */
export function useInfiniteScroll<T extends HTMLElement>({
  hasNext,
  loading,
  onLoad,
}: {
  hasNext: boolean
  /** Идёт ли загрузка следующей страницы: пока идёт, повторно не дёргаем. */
  loading: boolean
  onLoad: () => void
}): (node: T | null) => void {
  const node = useRef<T | null>(null)
  const observer = useRef<IntersectionObserver | null>(null)
  const visible = useRef(false)
  const state = useRef({ hasNext, loading, onLoad })
  state.current = { hasNext, loading, onLoad }

  const maybeLoad = useCallback(() => {
    const s = state.current
    if (visible.current && s.hasNext && !s.loading) s.onLoad()
  }, [])

  useEffect(() => {
    maybeLoad()
  }, [hasNext, loading, maybeLoad])

  useEffect(() => () => observer.current?.disconnect(), [])

  return useCallback(
    (next: T | null) => {
      if (next === node.current) return
      node.current = next
      observer.current?.disconnect()
      visible.current = false
      if (!next) return
      // Без IntersectionObserver (старый движок, jsdom в тестах) автоподгрузки нет:
      // показать сразу всё — не выход, у ленты страниц может быть сколько угодно.
      if (typeof IntersectionObserver === 'undefined') return
      observer.current = new IntersectionObserver(
        (entries) => {
          visible.current = entries.some((e) => e.isIntersecting)
          maybeLoad()
        },
        // Экран запаса: подгрузка начинается за пол-экрана до конца списка, и
        // читатель не видит ни кнопки, ни паузы.
        { rootMargin: '600px' },
      )
      observer.current.observe(next)
    },
    [maybeLoad],
  )
}
