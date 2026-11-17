'use client'

import { useEffect, useRef, useState } from 'react'
import {
  createSpring,
  prefersReducedMotion,
  projectMomentum,
  rubberband,
  velocityFrom,
  type SpringHandle,
} from '../../../shared/lib'

/**
 * Свайп между вкладками общих материалов правой колонки (Telegram: медиа → файлы → ссылки
 * листаются пальцем). Палец ведёт содержимое 1:1, за первой и последней вкладкой — резина;
 * отпускание решает по точке, где содержимое остановилось бы само (короткий флик листает,
 * вялый сдвиг на треть — нет). Уход и въезд — пружина (shared/lib/spring.ts), скорость
 * пальца переходит в доводку. Мышью не листается: у неё есть вкладки сверху.
 *
 * Возвращает callback-ref для обёртки содержимого вкладок: обёртка пересоздаётся, когда
 * колонка уходит в управление группой и возвращается. Обёртке нужен `touch-pan-y`, чтобы
 * вертикальную прокрутку колонки браузер вёл сам.
 */
export function useTabSwipe({
  tabs,
  current,
  onChange,
}: {
  tabs: readonly string[]
  current: string
  onChange: (tab: string) => void
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  // Свежие значения для обработчиков, подписанных один раз.
  const state = useRef({ tabs, current, onChange })
  state.current = { tabs, current, onChange }
  const springRef = useRef<SpringHandle | null>(null)
  // Что делать, когда пружина сядет: после ухода — сменить вкладку и въехать с другой стороны.
  const restRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!el) return
    const render = (x: number): void => {
      el.style.transform = x === 0 ? '' : `translate3d(${x}px, 0, 0)`
    }
    const spring = createSpring({
      from: 0,
      damping: 1,
      response: 0.32,
      onChange: render,
      onRest: () => {
        const next = restRef.current
        restRef.current = null
        next?.()
      },
    })
    springRef.current = spring

    let pointerId: number | null = null
    let startX = 0
    let startY = 0
    let base = 0
    let axis: 'x' | 'y' | null = null
    let history: { position: number; time: number }[] = []

    const neighbour = (dir: 1 | -1): string | null => {
      const { tabs: list, current: cur } = state.current
      const i = list.indexOf(cur)
      return i === -1 ? null : (list[i + dir] ?? null)
    }

    const onDown = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse' || pointerId !== null) return
      const target = e.target as Element | null
      // Свои горизонтальные жесты (плеер, поле ввода, лента фото) — не наши.
      if (target?.closest('input,textarea,[data-no-tab-swipe],[role="slider"]')) return
      pointerId = e.pointerId
      startX = e.clientX
      startY = e.clientY
      axis = null
      history = [{ position: e.clientX, time: e.timeStamp }]
    }
    const onMove = (e: PointerEvent): void => {
      if (e.pointerId !== pointerId) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (axis === null) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
        axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
        if (axis === 'y') {
          pointerId = null
          return
        }
        // Перехват на лету: база — где содержимое на экране сейчас.
        restRef.current = null
        spring.stop()
        base = spring.value
        el.setPointerCapture(e.pointerId)
      }
      history.push({ position: e.clientX, time: e.timeStamp })
      if (history.length > 8) history.shift()
      const w = el.offsetWidth || 1
      let x = base + dx
      // Соседа нет — резина: край ощущается, но не пускает.
      if (x > 0 && !neighbour(-1)) x = rubberband(x, w)
      if (x < 0 && !neighbour(1)) x = -rubberband(-x, w)
      spring.set(x)
      render(x)
    }
    const onUp = (e: PointerEvent): void => {
      if (e.pointerId !== pointerId) return
      pointerId = null
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (axis !== 'x') return
      const w = el.offsetWidth || 1
      const velocity = velocityFrom(history)
      const projected = spring.value + projectMomentum(velocity, 0.99)
      const dir: 1 | -1 = projected < 0 ? 1 : -1
      const next = Math.abs(projected) > w / 3 ? neighbour(dir) : null
      if (!next) {
        spring.to(0, velocity)
        return
      }
      if (prefersReducedMotion()) {
        spring.set(0)
        render(0)
        state.current.onChange(next)
        return
      }
      // Уезжает текущая, на её месте — новая, въезжает с противоположной стороны.
      restRef.current = () => {
        state.current.onChange(next)
        spring.set(dir * w)
        render(dir * w)
        spring.to(0)
      }
      spring.to(-dir * w, velocity)
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    return () => {
      spring.stop()
      render(0)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    }
  }, [el])

  // Вкладку сменили нажатием сверху посреди анимации — содержимое встаёт на место.
  useEffect(() => {
    const spring = springRef.current
    if (!spring || restRef.current || spring.value === 0) return
    if (!spring.animating) {
      spring.set(0)
      if (el) el.style.transform = ''
    }
  }, [current, el])

  return setEl
}
