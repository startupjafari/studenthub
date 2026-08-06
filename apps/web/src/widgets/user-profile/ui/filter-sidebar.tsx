'use client'

import type { ReactNode } from 'react'
import { Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

// Макет вкладок контента профиля: левая колонка фильтров/сортировки + основной контент.
// На мобильном сайдбар складывается над контентом; на десктопе — липкая колонка слева.
export function ContentLayout({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start lg:gap-6">
      <aside className="flex flex-col gap-5 lg:sticky lg:top-4">{sidebar}</aside>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

// Группа фильтров: заголовок (+ опциональное действие справа) и вертикальный список опций.
export function FilterGroup({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        {action}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

// Скелет боковой колонки фильтров — повторяет структуру FilterGroup (заголовок + строки-опции),
// чтобы разметка при загрузке совпадала с загруженной.
export function FilterSkeleton({ groups = 2, options = 3 }: { groups?: number; options?: number }) {
  return (
    <>
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
