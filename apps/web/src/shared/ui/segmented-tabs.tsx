'use client'

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from 'shared/lib/utils'

// Переключатель разделов страницы для шапки (PageHeader). Раньше каждый экран
// собирал такие табы вручную: контейнер `bg-muted/50` + активная вкладка сплошным
// `bg-primary` — тяжёлый синий блок внутри шапки. Здесь единый компонент в том же
// визуальном языке, что пункты сайдбара: подсветка активного `bg-primary/10 text-primary`,
// неактивные — приглушённые, без обводки-контейнера.

export interface SegmentedTabItem<T extends string> {
  value: T
  label: ReactNode
  /** Счётчик справа от подписи (например число новых жалоб). 0 не показывается. */
  count?: number
  icon?: LucideIcon
}

export interface SegmentedTabsProps<T extends string> {
  items: readonly SegmentedTabItem<T>[]
  value: T
  onChange: (value: T) => void
  /** Доступное имя группы переключателей. */
  'aria-label'?: string
  className?: string
}

export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  'aria-label': ariaLabel,
  className,
}: SegmentedTabsProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      // Список может не влезть в узкий экран — горизонтальная прокрутка без видимой полосы.
      className={cn(
        'flex min-w-0 max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-border bg-muted/50 p-1',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value
        const Icon = item.icon
        return (
          <button
            key={item.value}
            type="button"
            // aria-pressed, а не role="tab": это фильтр-переключатель, а связанной
            // tabpanel-области с id здесь нет — неполная tab-семантика хуже честной кнопки.
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-4 focus-visible:ring-ring/20',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
            {item.label}
            {!!item.count && (
              <span
                className={cn(
                  'min-w-5 rounded-full px-1.5 py-px text-center text-[0.6875rem] font-semibold tabular-nums',
                  active ? 'bg-primary/15 text-primary' : 'bg-foreground/10 text-muted-foreground',
                )}
              >
                {item.count > 99 ? '99+' : item.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
