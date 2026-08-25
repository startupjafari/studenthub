'use client'

import { CalendarClock } from 'lucide-react'
import { cn } from '../lib/utils'
import { FIELD_SIZE, type ControlSize } from './control-size'

// Поле выбора даты и времени: нативный datetime-local в едином оформлении (иконка + рамка как у Input).
export function DateTimeField({
  value,
  onChange,
  className,
  min,
  disabled,
  size = 'lg',
  'aria-label': ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  className?: string
  min?: string
  disabled?: boolean
  /** Размер из общей шкалы контролов (control-size.ts). */
  size?: ControlSize
  'aria-label'?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <CalendarClock
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        type="datetime-local"
        value={value}
        min={min}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full rounded-xl border border-input bg-background pr-3 pl-9 outline-none transition-[color,box-shadow,border-color] hover:border-ring/50 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50 dark:bg-input/30',
          FIELD_SIZE[size],
        )}
      />
    </div>
  )
}
