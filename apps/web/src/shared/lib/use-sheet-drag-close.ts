'use client'

import { useEffect, useRef, type RefObject } from 'react'

interface Options {
  /** Смещение вниз (px), после которого шторка закрывается. */
  threshold?: number
  /** Порог начала драга (px) — чтобы не реагировать на микродвижения/тапы. */
  startThreshold?: number
}

// Единый жест «потянуть шторку вниз, чтобы закрыть» для BottomSheet/ActionSheet.
// Ключевое отличие от прежних реализаций: touchmove вешаем НАТИВНО с { passive: false }
// и вызываем preventDefault во время активного драга — иначе React вешает passive-слушатель,
// preventDefault игнорируется, и жест параллельно уходит в документ (iOS pull-to-refresh /
// прокрутка фона). Так один жест принадлежит только шторке.
//
// Драг стартует лишь когда контент прокручен в самый верх (scrollTop === 0) и палец идёт ВНИЗ —
// иначе это обычная прокрутка контента шторки (её не перехватываем).
export function useSheetDragClose<T extends HTMLElement = HTMLDivElement>(
  onClose: () => void,
  options: Options = {},
): RefObject<T | null> {
  const ref = useRef<T | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const threshold = options.threshold ?? 96
    const startThreshold = options.startThreshold ?? 6
    let startY = 0
    let dy = 0
    let dragging = false

    const onStart = (e: TouchEvent): void => {
      // Драг закрытия — только от самого верха контента; иначе отдаём жест прокрутке.
      dragging = el.scrollTop <= 0
      startY = e.touches[0]?.clientY ?? 0
      dy = 0
    }

    const onMove = (e: TouchEvent): void => {
      if (!dragging) return
      dy = (e.touches[0]?.clientY ?? 0) - startY
      if (dy <= startThreshold) {
        el.style.transform = ''
        return
      }
      // Жест принадлежит шторке — не даём странице подхватить его (pull-to-refresh/скролл).
      if (e.cancelable) e.preventDefault()
      el.style.transform = `translateY(${dy}px)`
    }

    const onEnd = (): void => {
      if (!dragging) return
      dragging = false
      el.style.transform = ''
      el.style.transition = ''
      if (dy > threshold) onCloseRef.current()
      dy = 0
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    // passive:false — обязательно, иначе preventDefault() не сработает.
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [options.threshold, options.startThreshold])

  return ref
}
