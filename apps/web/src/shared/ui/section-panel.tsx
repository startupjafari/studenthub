'use client'

import type { ReactNode } from 'react'
import { Card } from './card'
import { cn } from '../lib/utils'

/**
 * Панель раздела: шапка с заголовком и пояснением, под ней содержимое.
 *
 * `subtitle` обязателен намеренно. Панель сводки показывает агрегат, и без строки
 * «зачем это тут» читатель видит цифры, но не знает, какое решение по ним принимать.
 * Одно предложение в шапке дешевле любой документации.
 *
 * `gap-0 py-0` у карточки: содержимое рисует свои отступы, иначе между линией шапки
 * и графиком остаётся лишняя полоса.
 */
export function SectionPanel({
  title,
  subtitle,
  actions,
  bodyClassName,
  className,
  children,
}: {
  title: ReactNode
  subtitle: ReactNode
  /** Управление справа в шапке: переключатель периода, ссылка «все». */
  actions?: ReactNode
  bodyClassName?: string
  className?: string
  children: ReactNode
}) {
  return (
    <Card className={cn('gap-0 py-0', className)}>
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {actions}
      </div>
      <div className={cn('px-4 py-3', bodyClassName)}>{children}</div>
    </Card>
  )
}
