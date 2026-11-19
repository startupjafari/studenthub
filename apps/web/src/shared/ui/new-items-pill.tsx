'use client'

import { ArrowUp } from 'lucide-react'
import { cn } from '../lib/utils'

/**
 * Плашка «N новых» над списком (как в X, Telegram-каналах, LinkedIn): новое пришло по сокету,
 * но список не прыгает под читающим — он сам решает, когда подтянуть. Плашка въезжает сверху,
 * по нажатию родитель перечитывает список и прокручивает к началу.
 *
 * Липкая сверху своего скролл-контейнера, поэтому стоит над списком, а не над страницей.
 */
export function NewItemsPill({
  count,
  label,
  onClick,
  className,
}: {
  /** Сколько нового; 0 — плашки нет. */
  count: number
  /** Готовая подпись с числом («3 новые публикации») — склонение решает вызывающий. */
  label: string
  onClick: () => void
  className?: string
}) {
  if (count <= 0) return null
  return (
    <div className={cn('pointer-events-none sticky top-2 z-20 flex justify-center', className)}>
      <button
        type="button"
        onClick={onClick}
        className="pointer-events-auto flex cursor-pointer items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg outline-none transition-[background-color,transform] duration-(--motion-control) animate-in fade-in-0 slide-in-from-top-3 hover:bg-primary/90 focus-visible:ring-4 focus-visible:ring-ring/30 active:scale-95 motion-reduce:transition-none"
      >
        <ArrowUp className="size-4" aria-hidden />
        {label}
      </button>
    </div>
  )
}
