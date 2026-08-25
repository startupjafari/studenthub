import type { ReactNode } from 'react'

import { cn } from 'shared/lib/utils'

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

// Универсальное пустое/«скоро» состояние (docs/FRONTEND_RULES.md §9: у асинхронных
// экранов обязательно осмысленное empty-состояние).
//
// `min-h-0 flex-1` — состояние занимает всю доступную высоту блока: в flex-колонке
// (панель, карточка, страница с таблицей) оно растягивается и центрируется по вертикали,
// а не жмётся полоской у верхнего края. В обычном потоке эти классы ничего не меняют,
// поэтому проп-переключатель не нужен.
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-10 text-center',
        className,
      )}
    >
      {icon && (
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold">{title}</h3>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}
