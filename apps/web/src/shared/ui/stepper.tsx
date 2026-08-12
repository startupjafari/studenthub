'use client'

import { Check } from 'lucide-react'
import { cn } from '../lib/utils'

export interface StepperStep {
  id: string
  label: string
}

// Горизонтальный индикатор шагов: пройденные — с галочкой, текущий — подсвечен.
// current — подсвеченный шаг; done — сколько шагов пройдено (по умолчанию = current).
// onStepClick делает пройденные/текущий шаги кликабельными (возврат к ним).
export function Stepper({
  steps,
  current,
  done,
  onStepClick,
  className,
}: {
  steps: StepperStep[]
  current: number
  done?: number
  onStepClick?: (index: number) => void
  className?: string
}) {
  const doneCount = done ?? current

  return (
    <ol className={cn('flex items-center gap-1 overflow-x-auto pb-1', className)}>
      {steps.map((s, i) => {
        const isDone = i < doneCount
        const isActive = i === current
        const clickable = !!onStepClick && i <= doneCount
        return (
          <li key={s.id} className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={!clickable}
              aria-current={isActive ? 'step' : undefined}
              onClick={() => clickable && onStepClick?.(i)}
              className={cn(
                'flex items-center gap-2 rounded-full py-1 pr-3 pl-1 transition-colors',
                clickable ? 'cursor-pointer hover:bg-muted' : 'cursor-default',
              )}
            >
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : isDone
                      ? 'bg-primary/15 text-primary'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {isDone ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span
                className={cn(
                  'text-sm font-medium whitespace-nowrap',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {s.label}
              </span>
            </button>
            {i < steps.length - 1 && <span className="h-px w-5 shrink-0 bg-border" aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}
