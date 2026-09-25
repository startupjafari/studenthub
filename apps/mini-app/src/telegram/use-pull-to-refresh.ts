import { useEffect, useRef, useState } from 'react'
import { haptic } from './webapp'

// Обновление списка потягиванием вниз.
//
// Жест реализован руками, а не взят из библиотеки: единственное, что нужно, — отличить
// «тянут сверху вниз, находясь в самом верху» от обычной прокрутки, и это двадцать строк
// против килобайт зависимости.
//
// Важная тонкость Telegram: мини-апп вызывает `disableVerticalSwipes()`, иначе свайп вниз
// закрывает приложение. Прокрутка при этом остаётся, а значит и наш жест работает — но
// только пока список прокручен в самый верх, иначе мы отнимали бы жест у прокрутки.

const TRIGGER_PX = 70
const MAX_PULL_PX = 110

/**
 * Сопротивление резинкой — та самая кривая, по которой тянутся списки в iOS.
 *
 * Прежний расчёт (`delta * 0.4`) сопротивлялся одинаково с первого пикселя: индикатор
 * отставал от пальца сразу, и жест начинался с ощущения, что экран приклеен. Здесь первые
 * миллиметры идут почти один к одному — палец ведёт, — а упор нарастает по мере
 * оттягивания и уводит смещение к пределу, которого не перейти.
 *
 * `LIMIT` — тот самый предел (асимптота), а не расстояние срабатывания.
 */
const LIMIT_PX = 220

function rubberband(delta: number): number {
  return (delta * LIMIT_PX) / (LIMIT_PX + delta)
}

export function usePullToRefresh(onRefresh: () => void | Promise<void>) {
  const [pull, setPull] = useState(0)
  const startY = useRef<number | null>(null)
  const handler = useRef(onRefresh)
  handler.current = onRefresh
  // Обработчики подписаны один раз, поэтому свежие значения читаются из ref, а не из
  // замыкания: иначе каждое движение пальца переподписывало бы три слушателя.
  const pullRef = useRef(0)

  useEffect(() => {
    const atTop = (): boolean => (document.scrollingElement?.scrollTop ?? 0) <= 0

    const onStart = (event: TouchEvent): void => {
      startY.current = atTop() ? (event.touches[0]?.clientY ?? null) : null
    }

    const onMove = (event: TouchEvent): void => {
      if (startY.current === null) return
      const delta = (event.touches[0]?.clientY ?? 0) - startY.current
      // Тянут вверх — это обычная прокрутка, отдаём жест ей.
      if (delta <= 0) {
        startY.current = null
        pullRef.current = 0
        setPull(0)
        return
      }
      const next = Math.min(MAX_PULL_PX, rubberband(delta))
      pullRef.current = next
      setPull(next)
    }

    const onEnd = (): void => {
      const reached = pullRef.current >= TRIGGER_PX
      startY.current = null
      pullRef.current = 0
      setPull(0)
      if (reached) {
        haptic.tap()
        void handler.current()
      }
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', onEnd)
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
    }
  }, [])

  // Доля пройденного пути нужна снаружи: индикатор проявляется вместе с жестом, а не
  // возникает готовым — по нему видно, сколько ещё тянуть.
  return { pull, ready: pull >= TRIGGER_PX, progress: Math.min(1, pull / TRIGGER_PX) }
}
