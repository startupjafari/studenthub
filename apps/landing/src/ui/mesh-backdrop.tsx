'use client'

import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react'

/** Сторона пятна подсветки, px. Совпадает с размером .mesh-spot в globals.css. */
const SPOT = 480
/** Шаг точечной сетки, px. Совпадает с background-size у .mesh-base и .mesh-spot__dots. */
const GRID = 24

/**
 * Брендовый фон первого экрана: точечная сетка, которая подсвечивается вокруг курсора.
 *
 * Приём взят с панели входа платформы, но устроен иначе, и это ради кадровой частоты.
 * Там позиция мыши пишется в CSS-переменные, от которых зависит маска на весь блок:
 * каждое движение мыши — пересчёт стилей всего поддерева и перерисовка слоя размером с
 * экран. На слабом ноутбуке это ровно те кадры, которые теряются.
 *
 * Здесь подсветка — пятно фиксированного размера, которое едет за курсором через
 * `transform`. Внутри него точки сдвигаются тоже трансформом, на остаток от шага сетки,
 * поэтому совпадают с точками фона пиксель в пиксель. Ни перерисовки, ни пересчёта
 * раскладки: браузер только переставляет готовые слои. Позиция обновляется не чаще
 * одного раза за кадр.
 *
 * Панель больше не заливается синим. Раньше первый экран был отдельным цветным блоком, и
 * страница начиналась со шва: синее полотно, дальше ровный фон. Теперь сетка лежит прямо
 * на земле документа поверх общей подсветки — бренд остался, шов ушёл. Из-за этого точки
 * и берут цвет из --foreground: на белом полотне светлой темы белые точки были не видны.
 *
 * Это единственный клиентский компонент первого экрана: остальное — статическая разметка.
 */
export function MeshBackdrop({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const spotRef = useRef<HTMLDivElement>(null)
  const dotsRef = useRef<HTMLDivElement>(null)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const frame = useRef(0)

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  function paint() {
    frame.current = 0
    const root = rootRef.current
    const spot = spotRef.current
    const dots = dotsRef.current
    const at = pointer.current
    if (!root || !spot || !dots || !at) return

    const rect = root.getBoundingClientRect()
    const left = Math.round(at.x - rect.left - SPOT / 2)
    const top = Math.round(at.y - rect.top - SPOT / 2)
    // Остаток от шага сетки, всегда неотрицательный: точки внутри пятна обязаны лечь
    // на те же координаты, что и точки фона под ним.
    const shiftX = ((left % GRID) + GRID) % GRID
    const shiftY = ((top % GRID) + GRID) % GRID

    spot.style.transform = `translate3d(${left}px, ${top}px, 0)`
    dots.style.transform = `translate3d(${-shiftX}px, ${-shiftY}px, 0)`
    spot.classList.add('is-on')
  }

  function handleMove(e: PointerEvent<HTMLDivElement>) {
    // Только мышь: на тач-экране подсветка «залипала» бы в точке последнего касания.
    if (e.pointerType !== 'mouse') return
    pointer.current = { x: e.clientX, y: e.clientY }
    if (!frame.current) frame.current = requestAnimationFrame(paint)
  }

  function handleLeave() {
    pointer.current = null
    spotRef.current?.classList.remove('is-on')
  }

  return (
    <div
      ref={rootRef}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      className={`relative isolate flex flex-col overflow-hidden ${className}`}
    >
      <div aria-hidden className="mesh-base pointer-events-none absolute inset-0" />
      <div ref={spotRef} aria-hidden className="mesh-spot pointer-events-none">
        <div className="mesh-spot__halo" />
        <div className="mesh-spot__mask">
          <div ref={dotsRef} className="mesh-spot__dots" />
        </div>
      </div>
      <div className="relative flex flex-1 flex-col">{children}</div>
    </div>
  )
}
