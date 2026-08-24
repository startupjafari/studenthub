'use client'

import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from './button'
import { cn } from '../lib/utils'

export interface PageHeaderProps {
  title: ReactNode
  /** Подзаголовок под заголовком (мелкий, приглушённый). */
  subtitle?: ReactNode
  /**
   * Иконка раздела слева от заголовка — тот же изразец `bg-primary/10`, что в строках
   * списков. Даёт шапке опору: без неё голый текст висит в пустой полосе.
   */
  icon?: LucideIcon
  /** Кнопка «назад» слева (детальные/вложенные страницы). */
  onBack?: () => void
  backLabel?: string
  /** Переключатель разделов — обычно `SegmentedTabs`. Стоит справа, перед действиями. */
  tabs?: ReactNode
  /** Действия справа (кнопки, поиск, скачивание). */
  actions?: ReactNode
  /**
   * Растянуть шапку на всю ширину области контента, погасив внутренние отступы `main`
   * (по умолчанию). Выключать там, где шапка стоит не на верхнем уровне страницы —
   * например внутри колонки grid: отрицательные отступы вытащили бы её из колонки.
   */
  bleed?: boolean
  className?: string
}

// Шапка страницы — самостоятельная горизонтальная полоса в том же визуальном языке,
// что сайдбар: поверхность `bg-sidebar`, снизу разделительная линия. Внутри в одну
// строку: [назад] [иконка] Заголовок(+описание) … справа: табы + действия.
//
// Полоса идёт вплотную к сайдбару и к верху области контента, без скругления и внешних
// отступов. `main` в AppShell задаёт свой padding (p-4 / md:p-6 + safe-area сверху),
// поэтому шапка гасит его отрицательными margin'ами — значения обязаны совпадать с main.
// Оформление задаётся здесь одним местом: все страницы уже используют PageHeader.
export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  onBack,
  backLabel,
  tabs,
  actions,
  bleed = true,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-sidebar px-4 py-2 md:px-6',
        // Значения зеркалят padding `main`: p-4 / md:p-6 по бокам и
        // pt-[calc(1rem+env(safe-area-inset-top))] / md:pt-6 сверху.
        bleed && 'mt-[calc(-1rem-env(safe-area-inset-top))] -mx-4 md:-mx-6 md:-mt-6',
        className,
      )}
    >
      {onBack && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="-ml-1.5 shrink-0"
          onClick={onBack}
          aria-label={backLabel}
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Button>
      )}
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
            aria-hidden
          >
            <Icon className="size-4" />
          </span>
        )}
        {/* `leading-tight` — полоса шапки не должна расти: с обычной высотой строки
            заголовок с подзаголовком добавляют к ней лишние ~6 px. */}
        <div className="min-w-0">
          <h1 className="truncate text-lg leading-tight font-bold">{title}</h1>
          {subtitle && (
            <p className="truncate text-xs leading-tight text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
      {/* Табы и действия — одна правая зона: полоса читается как «слева кто я, справа чем
          управляю». `max-w-full` + `flex-wrap`: набор из табов, поиска и кнопки не влезает
          в строку на телефоне — он переносится внутри шапки, а не вылезает за её край. */}
      {(tabs || actions) && (
        <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
          {tabs}
          {actions}
        </div>
      )}
    </header>
  )
}
