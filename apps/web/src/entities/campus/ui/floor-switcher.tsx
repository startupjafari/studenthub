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
 * редактор этажа): строка кнопок в правом нижнем углу холста, нижние этажи слева. Не спорит
 * с панелью справа от карты и не закрывает середину плана. Этажей больше, чем влезает, —
 * строка прокручивается, выбранный этаж держится в поле зрения. `items` — снизу вверх.
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
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeKey])

  if (items.length < 2) return null
  return (
    <nav
      aria-label={label}
      className={cn(
        'absolute right-3 bottom-3 z-10 flex max-w-[min(calc(100%-1.5rem),28rem)] rounded-xl bg-card/95 p-1 shadow-sm ring-1 ring-foreground/10 backdrop-blur',
        className,
      )}
    >
      <div
        ref={list}
        className="flex min-w-0 flex-row gap-1 overflow-x-auto overscroll-contain [scrollbar-width:none]"
      >
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
