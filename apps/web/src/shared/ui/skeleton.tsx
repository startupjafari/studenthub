import * as React from 'react'

import { cn } from 'shared/lib/utils'

/**
 * Заглушка на время загрузки.
 *
 * `fill` — блок или строка списка, которые занимают всю доступную высоту своей оболочки
 * (DESIGN_SYSTEM §10.4): заглушке добавляется `flex-1`, а метка `data-skeleton-fill`
 * растягивает до низа области контента всю цепочку родителей (`.sh-page-fill` в
 * globals.css) — пока идёт загрузка. Высоту, ниже которой нельзя, задают `min-h-*`, а не
 * `h-*`: в обычном потоке (модалка, поповер) заглушка остаётся этой высоты. Строки списка
 * с `fill` делят высоту поровну. Без `fill` — инлайн-заглушка: строка текста, аватар.
 */
function Skeleton({
  className,
  fill = false,
  ...props
}: React.ComponentProps<'div'> & { fill?: boolean }) {
  return (
    <div
      data-slot="skeleton"
      data-skeleton-fill={fill ? '' : undefined}
      className={cn('animate-pulse rounded-md bg-muted', fill && 'w-full flex-1', className)}
      {...props}
    />
  )
}

export { Skeleton }
