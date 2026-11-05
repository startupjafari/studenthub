'use client'

import { useEffect, useRef } from 'react'
import { cn } from '../../../shared/lib'

export interface FloorSwitcherItem {
  key: string
  /** Короткая подпись на кнопке: «1», «-1», «Ц». */
  label: string
  /** Полная подпись для читалки: «1 этаж». */
  ariaLabel: string
  active: boolean
  onSelect: () => void
}

/**
 * Переключатель этажей — одинаковый на всех экранах кампуса (зритель: план, 3D, кампус;
 * редактор этажа): колонка кнопок «как в лифте» у правого края холста, по центру высоты —
 * там, где её ищут на картах (2ГИС), и под рукой при любой высоте окна. Этажей больше, чем
 * влезает, — колонка прокручивается, выбранный этаж держится в поле зрения.
 * Кладётся прямо в холст с `position: relative`.
 */
export function FloorSwitcher({
  items,
  label,
  className,
}: {
  items: FloorSwitcherItem[]
  label: string
  className?: string
}) {
  const list = useRef<HTMLDivElement>(null)
  const activeKey = items.find((x) => x.active)?.key
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeKey])

  if (items.length < 2) return null
  return (
    <nav
      aria-label={label}
      className={cn(
        'absolute top-1/2 right-3 z-10 flex max-h-[calc(100%-1.5rem)] -translate-y-1/2 flex-col rounded-xl bg-card/95 p-1 shadow-sm ring-1 ring-foreground/10 backdrop-blur',
        className,
      )}
    >
      <div ref={list} className="flex min-h-0 flex-col gap-1 overflow-y-auto overscroll-contain">
        {items.map((x) => (
          <button
            key={x.key}
            type="button"
            aria-current={x.active}
            aria-label={x.ariaLabel}
            title={x.ariaLabel}
            onClick={x.onSelect}
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-xl text-sm font-semibold tabular-nums md:size-9',
              'hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none focus-visible:ring-inset',
              x.active && 'bg-primary text-primary-foreground hover:bg-primary',
            )}
          >
            {x.label}
          </button>
        ))}
      </div>
    </nav>
  )
}
