'use client'

import { Children, isValidElement, useState, type ReactNode } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { ChevronDown } from 'lucide-react'
import { Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

// Макет вкладок контента профиля. Десктоп (lg): липкая колонка фильтров/сортировки слева.
// Мобильный: компактный ряд «чипов»-дропдаунов над контентом (список раскрывается в поповере).
export function ContentLayout({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start lg:gap-6">
      <aside className="flex flex-row flex-wrap gap-2 lg:sticky lg:top-4 lg:flex-col lg:gap-4">
        {sidebar}
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

// Подпись активной опции (по props.active у детей-FilterOption) — для чипа на мобильном.
function activeLabelOf(children: ReactNode): string | undefined {
  let label: string | undefined
  Children.forEach(children, (ch) => {
    if (!isValidElement(ch)) return
    const p = ch.props as { active?: boolean; label?: string }
    if (p.active && typeof p.label === 'string') label = p.label
  })
  return label
}

// Группа фильтров. На десктопе — заголовок + список опций. На мобильном — чип-дропдаун:
// кнопка показывает заголовок и текущее значение, полный список открывается в поповере.
export function FilterGroup({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const activeLabel = activeLabelOf(children)

  return (
    <>
      {/* Десктоп */}
      <div className="hidden flex-col gap-1.5 lg:flex">
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {title}
          </p>
          {action}
        </div>
        <div className="flex flex-col gap-0.5">{children}</div>
      </div>

      {/* Мобильный: чип-дропдаун */}
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            className="flex max-w-full items-center gap-1.5 rounded-full border border-input bg-background py-1.5 pr-2 pl-3 text-xs font-medium text-foreground transition-colors hover:border-ring/50 aria-expanded:border-ring lg:hidden dark:bg-input/30"
          >
            <span className="shrink-0 text-muted-foreground">{title}</span>
            {activeLabel && <span className="min-w-0 truncate">{activeLabel}</span>}
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            sideOffset={6}
            onClick={(e) => {
              // Закрываем только при выборе опции (data-opt), не при действиях/вводе (создание/переименование альбома).
              if ((e.target as HTMLElement).closest('[data-opt]')) setOpen(false)
            }}
            className="z-[110] max-h-[60vh] w-56 overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 lg:hidden"
          >
            {action && (
              <div className="flex items-center justify-between px-2 pt-1 pb-1">
                <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {title}
                </span>
                {action}
              </div>
            )}
            {children}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </>
  )
}

// Скелет боковой колонки: на мобильном — чипы, на десктопе — колонки (совпадает с загруженной разметкой).
export function FilterSkeleton({ groups = 2, options = 3 }: { groups?: number; options?: number }) {
  return (
    <>
      <div className="flex flex-wrap gap-2 lg:hidden">
        {Array.from({ length: groups }).map((_, g) => (
          <Skeleton key={g} className="h-8 w-28 rounded-full" />
        ))}
      </div>
      <div className="hidden lg:contents">
        {Array.from({ length: groups }).map((_, g) => (
          <div key={g} className="flex flex-col gap-1.5">
            <Skeleton className="mx-1 h-3 w-24" />
            <div className="flex flex-col gap-0.5">
              {Array.from({ length: options }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full rounded-lg" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// Опция фильтра: полноширинная строка-кнопка, активная подсвечена. actions — хвостовые
// кнопки (переименовать/удалить), рендерятся рядом (не вложены в основную кнопку).
export function FilterOption({
  active,
  onClick,
  icon,
  label,
  count,
  actions,
}: {
  active: boolean
  onClick: () => void
  icon?: ReactNode
  label: string
  count?: number
  actions?: ReactNode
}) {
  return (
    <div
      className={cn(
        'group/opt flex items-center rounded-lg transition-colors',
        active ? 'bg-primary/10' : 'hover:bg-muted',
      )}
    >
      <button
        type="button"
        data-opt
        onClick={onClick}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-sm',
          active ? 'font-medium text-primary' : 'text-foreground',
        )}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined && (
          <span
            className={cn('shrink-0 text-xs', active ? 'text-primary/70' : 'text-muted-foreground')}
          >
            {count}
          </span>
        )}
      </button>
      {actions && <div className="flex shrink-0 items-center gap-0.5 pr-1.5">{actions}</div>}
    </div>
  )
}
