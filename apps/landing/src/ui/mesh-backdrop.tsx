'use client'

import { useRef, type PointerEvent, type ReactNode } from 'react'

/**
 * Брендовый фон первого экрана: точечная сетка, которая подсвечивается вокруг курсора.
 *
 * Приём взят с панели входа платформы: позиция мыши пишется в CSS-переменные --mx/--my
 * напрямую через ref, без состояния React, — иначе каждое движение мыши перерисовывало бы
 * дерево. Сами правила .mesh-* лежат в globals.css.
 *
 * Это единственный клиентский компонент первого экрана: остальное — статическая разметка.
 */
export function MeshBackdrop({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  function handleMove(e: PointerEvent<HTMLDivElement>) {
    // Только мышь: на тач-экране подсветка «залипала» бы в точке последнего касания.
    if (e.pointerType !== 'mouse') return
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - rect.left}px`)
    el.style.setProperty('--my', `${e.clientY - rect.top}px`)
  }

  function handleLeave() {
    // Уводим подсветку далеко за пределы панели.
    const el = ref.current
    if (!el) return
    el.style.setProperty('--mx', '-9999px')
    el.style.setProperty('--my', '-9999px')
  }

  return (
    <div
      ref={ref}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      className="relative isolate overflow-hidden bg-primary text-primary-foreground"
    >
      <div aria-hidden className="mesh-base pointer-events-none absolute inset-0" />
      <div aria-hidden className="mesh-glow pointer-events-none absolute inset-0" />
      <div aria-hidden className="mesh-halo pointer-events-none absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 to-transparent"
      />
      <div className="relative">{children}</div>
    </div>
  )
}
