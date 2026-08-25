'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../../../shared/lib/utils'

export interface MemberMenuItem {
  key: string
  label: string
  icon: LucideIcon
  onClick: () => void
  danger?: boolean
}

// Небольшое меню действий над участником: позиционируется у точки (ПКМ) или кнопки «три точки»,
// удерживается в пределах экрана, закрывается по клику вне / Escape.
export function MemberActionsMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MemberMenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    })
  }, [x, y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[120]" role="menu">
      <div
        ref={ref}
        style={{ left: pos.left, top: pos.top }}
        className="absolute w-52 overflow-hidden rounded-2xl border border-border bg-popover py-1 shadow-lg"
      >
        {items.map((it) => {
          const Icon = it.icon
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => {
                it.onClick()
                onClose()
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
                it.danger ? 'text-destructive' : 'text-foreground',
              )}
            >
              <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
              {it.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
