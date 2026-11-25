'use client'

import { useEffect, useRef, type RefObject } from 'react'

/**
 * Тонкая полоса прогресса чтения у верхнего края. Считается по самой статье, а не по всей
 * странице: обсуждение и похожие статьи под текстом не должны «съедать» последнюю треть
 * полосы. Ширина меняется через transform прямо в DOM, без перерисовки React, и не чаще
 * кадра; на сервер ничего не уходит.
 */
export function ReadingProgress({ target }: { target: RefObject<HTMLElement | null> }) {
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let frame = 0
    const update = (): void => {
      frame = 0
      const el = target.current
      const bar = barRef.current
      if (!el || !bar) return
      const rect = el.getBoundingClientRect()
      const span = rect.height - window.innerHeight
      const done = span <= 0 ? (rect.top <= 0 ? 1 : 0) : -rect.top / span
      bar.style.transform = `scaleX(${Math.min(1, Math.max(0, done))})`
    }
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    // Прокручивается не окно, а область контента оболочки: слушаем все прокрутки (capture).
    document.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      document.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
    }
  }, [target])

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5">
      <div
        ref={barRef}
        className="h-full origin-left bg-primary will-change-transform"
        style={{ transform: 'scaleX(0)' }}
      />
    </div>
  )
}
