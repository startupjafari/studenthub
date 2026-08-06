'use client'

import { useRef, type PointerEvent } from 'react'
import { GraduationCap } from 'lucide-react'

export interface MeshBrandPanelProps {
  title: string
  subtitle: string
  copyright: string
}

// Брендовая панель auth с интерактивной меш-сеткой: точки подсвечиваются вокруг курсора.
// Позиция мыши пишется в CSS-переменные --mx/--my через ref (без ре-рендеров React);
// маска-«прожектор» показывает яркий слой точек только рядом с курсором (см. globals.css).
export function MeshBrandPanel({ title, subtitle, copyright }: MeshBrandPanelProps) {
  const ref = useRef<HTMLElement>(null)

  function handleMove(e: PointerEvent<HTMLElement>) {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - rect.left}px`)
    el.style.setProperty('--my', `${e.clientY - rect.top}px`)
  }

  function handleLeave() {
    const el = ref.current
    if (!el) return
    // Уводим подсветку далеко за пределы панели.
    el.style.setProperty('--mx', '-9999px')
    el.style.setProperty('--my', '-9999px')
  }

  return (
    <aside
      ref={ref}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-primary p-10 text-primary-foreground lg:flex"
    >
      <div aria-hidden className="mesh-base pointer-events-none absolute inset-0" />
      <div aria-hidden className="mesh-glow pointer-events-none absolute inset-0" />
      <div aria-hidden className="mesh-halo pointer-events-none absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 to-transparent"
      />

      <div className="relative flex items-center gap-2">
        <GraduationCap className="size-7" aria-hidden />
        <span className="text-xl font-bold">StudentHub</span>
      </div>

      <div className="relative">
        <h1 className="text-3xl leading-tight font-bold">{title}</h1>
        <p className="mt-3 max-w-sm text-primary-foreground/80">{subtitle}</p>
      </div>

      <p className="relative text-sm text-primary-foreground/60">{copyright}</p>
    </aside>
  )
}
