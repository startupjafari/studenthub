'use client'

import { useEffect, useRef, type RefObject } from 'react'

interface Options {
  /** Смещение вниз (px), после которого шторка закрывается. */
  threshold?: number
  /** Порог начала драга (px) — чтобы не реагировать на микродвижения/тапы. */
  startThreshold?: number
  /** Скорость флика вниз (px/ms), при которой закрываем даже без порога смещения. */
  flingVelocity?: number
}

// Единый жест «потянуть шторку вниз, чтобы закрыть» для BottomSheet/ActionSheet.
//
// Плавность (Telegram-стиль):
//  • во время драга — transition отключён, лист 1:1 следует за пальцем (только вниз);
//  • при отпускании ниже порога ИЛИ быстром флике вниз — лист плавно «уезжает» за нижний край,
//    и лишь по завершении анимации вызывается onClose (без резкого исчезновения);
//  • иначе — пружинный возврат к исходной позиции с той же анимацией.
//
// touchmove вешаем НАТИВНО с { passive: false } и делаем preventDefault во время активного драга —
// иначе React вешает passive-слушатель, preventDefault игнорируется, и жест параллельно уходит в
// документ (iOS pull-to-refresh / прокрутка фона). Так один жест принадлежит только шторке.
//
// Драг стартует лишь когда контент прокручен в самый верх (scrollTop === 0) и палец идёт ВНИЗ —
// иначе это обычная прокрутка контента шторки (её не перехватываем).
const SETTLE_EASE = 'transform 0.24s cubic-bezier(0.22, 0.61, 0.36, 1)'

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
    const flingVelocity = options.flingVelocity ?? 0.55
    let startY = 0
    let dy = 0
    let dragging = false
    let settling = false // идёт анимация доводки/возврата — новые касания игнорируем
    let lastY = 0
    let lastT = 0
    let velocity = 0 // px/ms, положительная — движение вниз

    const clearTransitionOnEnd = (e: TransitionEvent): void => {
      if (e.propertyName !== 'transform') return
      el.style.transition = ''
      el.removeEventListener('transitionend', clearTransitionOnEnd)
      settling = false
    }

    const animateClose = (): void => {
      settling = true
      el.style.transition = SETTLE_EASE
      // Уезжаем за нижний край экрана, затем закрываем по завершении анимации.
      el.style.transform = `translateY(${el.offsetHeight}px)`
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        el.removeEventListener('transitionend', onEndTransition)
        onCloseRef.current()
      }
      const onEndTransition = (e: TransitionEvent): void => {
        if (e.propertyName === 'transform') finish()
      }
      el.addEventListener('transitionend', onEndTransition)
      // Страховка, если transitionend не придёт (прерванная анимация/размонтирование).
      window.setTimeout(finish, 300)
    }

    const animateBack = (): void => {
      settling = true
      el.style.transition = SETTLE_EASE
      el.style.transform = ''
      el.addEventListener('transitionend', clearTransitionOnEnd)
      // Страховка на случай, если transform уже был 0 и transitionend не сработает.
      window.setTimeout(() => {
        el.style.transition = ''
        settling = false
      }, 300)
    }

    const onStart = (e: TouchEvent): void => {
      if (settling) return
      // Драг закрытия — только от самого верха контента; иначе отдаём жест прокрутке.
      dragging = el.scrollTop <= 0
      startY = e.touches[0]?.clientY ?? 0
      lastY = startY
      lastT = e.timeStamp
      dy = 0
      velocity = 0
      el.style.transition = 'none' // во время драга — мгновенное следование за пальцем
    }

    const onMove = (e: TouchEvent): void => {
      if (!dragging) return
      const y = e.touches[0]?.clientY ?? 0
      dy = y - startY
      const dt = e.timeStamp - lastT
      if (dt > 0) velocity = (y - lastY) / dt
      lastY = y
      lastT = e.timeStamp
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
      // Закрываем при достаточном смещении ИЛИ быстром флике вниз с заметным сдвигом.
      if (dy > threshold || (velocity > flingVelocity && dy > startThreshold)) animateClose()
      else animateBack()
      dy = 0
      velocity = 0
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
      el.removeEventListener('transitionend', clearTransitionOnEnd)
    }
  }, [options.threshold, options.startThreshold, options.flingVelocity])

  return ref
}
