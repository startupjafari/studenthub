'use client'

import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from './button'
import { cn } from '../lib/utils'

export interface PageHeaderProps {
  title: ReactNode
  /** Подзаголовок под заголовком (мелкий, приглушённый). */
  subtitle?: ReactNode
  /** Кнопка «назад» слева (детальные/вложенные страницы). */
  onBack?: () => void
  backLabel?: string
  /** Инлайн-табы или сегмент-контрол рядом с заголовком. */
  tabs?: ReactNode
  /** Действия справа (обычно кнопки). */
  actions?: ReactNode
  className?: string
}

// Минималистичная шапка страницы в одну строку: [назад] Заголовок · табы · действия(справа).
// Всё на одной горизонтали, на узких экранах элементы переносятся. Единый заголовок для всех страниц.
export function PageHeader({
  title,
  subtitle,
  onBack,
  backLabel,
  tabs,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
      {onBack && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="-ml-1 shrink-0"
          onClick={onBack}
          aria-label={backLabel}
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Button>
      )}
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold">{title}</h1>
        {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {tabs}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
