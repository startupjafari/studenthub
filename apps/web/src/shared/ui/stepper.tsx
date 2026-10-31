'use client'

import { Check } from 'lucide-react'
import { useScrollRow } from '../lib/use-scroll-row'
import { cn } from '../lib/utils'

export interface StepperStep {
  id: string
  label: string
}

// Горизонтальный индикатор шагов: пройденные — с галочкой, текущий — подсвечен.
// current — подсвеченный шаг; done — сколько шагов пройдено (по умолчанию = current).
// onStepClick делает пройденные/текущий шаги кликабельными (возврат к ним).
//
// Занимает всю ширину контейнера: тянутся соединительные линии, а сами шаги остаются
// по размеру подписи. Раньше линия была фиксированной (`w-5`), и на широкой панели
// вся лесенка жалась к левому краю.
//
// `layout="centered"` — для короткой лесенки (3–4 шага) в окне: шаги равной ширины, кружок
// по центру колонки, подпись под ним. Первый и последний шаги стоят на одинаковом
// расстоянии от краёв, а не прижаты к ним, как в строчном варианте.
export function Stepper({
  steps,
  current,
  done,
  onStepClick,
  layout = 'inline',
  className,
}: {
  steps: StepperStep[]
  current: number
  done?: number
  onStepClick?: (index: number) => void
  layout?: 'inline' | 'centered'
  className?: string
}) {
  const doneCount = done ?? current
  // Лесенка шагов в длинном сценарии не влезает в телефон: ряд тянется, у краёв затухает.
  const row = useScrollRow<HTMLOListElement>()

  if (layout === 'centered') {
    return (
      <ol className={cn('flex', className)}>
        {steps.map((s, i) => {
          const isDone = i < doneCount
          const isActive = i === current
          const clickable = !!onStepClick && i <= doneCount
          return (
            <li key={s.id} className="flex min-w-0 flex-1">
              <button
                type="button"
                disabled={!clickable}
                aria-current={isActive ? 'step' : undefined}
                onClick={() => clickable && onStepClick?.(i)}
                className={cn(
                  'group flex w-full min-w-0 flex-col items-center gap-1.5',
                  clickable ? 'cursor-pointer' : 'cursor-default',
                )}
              >
                <span className="flex w-full items-center gap-2">
                  {/* Линия к соседу: у крайних шагов наружу её нет, но место держим — иначе
                      кружок съехал бы от центра колонки. */}
                  <span
                    className={cn(
                      'h-px flex-1',
                      i === 0 ? 'invisible' : i <= doneCount ? 'bg-primary/40' : 'bg-border',
                    )}
                    aria-hidden
                  />
                  <span
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-shadow',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : isDone
                          ? 'bg-primary/15 text-primary'
                          : 'bg-muted text-muted-foreground',
                      clickable && !isActive && 'group-hover:ring-2 group-hover:ring-primary/30',
                    )}
                  >
                    {isDone && !isActive ? <Check className="size-3.5" aria-hidden /> : i + 1}
                  </span>
                  <span
                    className={cn(
                      'h-px flex-1',
                      i === steps.length - 1
                        ? 'invisible'
                        : i < doneCount
                          ? 'bg-primary/40'
                          : 'bg-border',
                    )}
                    aria-hidden
                  />
                </span>
                <span
                  className={cn(
                    'max-w-full px-1 text-center text-xs font-medium break-words sm:text-sm',
                    isActive ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {s.label}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    )
  }

  return (
    <ol
      ref={row.ref}
      className={cn(
        'flex items-center gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        row.overflowing && 'cursor-grab',
        row.dragging && 'cursor-grabbing select-none',
        className,
      )}
      style={{ maskImage: row.fadeMask, WebkitMaskImage: row.fadeMask }}
    >
      {steps.map((s, i) => {
        const isDone = i < doneCount
        const isActive = i === current
        const clickable = !!onStepClick && i <= doneCount
        return (
          <li
            key={s.id}
            // Растягивается всё, кроме последнего шага: тянуть нечего — за ним нет линии.
            className={cn('flex items-center gap-1', i < steps.length - 1 && 'flex-1')}
          >
            <button
              type="button"
              disabled={!clickable}
              aria-current={isActive ? 'step' : undefined}
              onClick={() => clickable && onStepClick?.(i)}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-full py-1 pr-3 pl-1 transition-colors',
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
            {i < steps.length - 1 && (
              // `min-w-4` — на узком экране линия не схлопывается в ноль, а включает
              // горизонтальную прокрутку контейнера.
              <span className="h-px min-w-4 flex-1 bg-border" aria-hidden />
            )}
          </li>
        )
      })}
    </ol>
  )
}
