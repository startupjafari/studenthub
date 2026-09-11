'use client'

import type { ComponentProps } from 'react'
import { useScrollRow } from 'shared/lib/use-scroll-row'
import { cn } from 'shared/lib/utils'

// Горизонтальный ряд, который может не влезть в экран: чипы, миниатюры, тулбар, шаги.
// Полосу прокрутки такие ряды не показывают (она перекрывает кромку содержимого), поэтому
// сами по себе они не сообщают ни что прокручиваются, ни как это сделать мышью. Здесь
// собрано всё сразу: скрытая прокрутка, перетаскивание мышью с инерцией (на тач-экране —
// нативная прокрутка, §7.1) и затухание у краёв как подсказка «есть ещё».
//
// Табы с выбранным значением берут не это, а `SegmentedTabs`: у них поверх ряда ещё
// доводка активного пункта в видимую зону и сворачивание в селектор на узком экране.

export interface ScrollRowProps extends ComponentProps<'div'> {
  /** Затухание у краёв. Выключить, если ряд лежит на неоднородном фоне и маска его режет. */
  fade?: boolean
}

export function ScrollRow({ className, style, fade = true, children, ...props }: ScrollRowProps) {
  const row = useScrollRow<HTMLDivElement>()
  const mask = fade ? row.fadeMask : undefined

  return (
    <div
      ref={row.ref}
      className={cn(
        'flex min-w-0 max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        // Курсор-рука только там, где есть мышь и есть куда тянуть.
        row.overflowing && 'cursor-grab',
        row.dragging && 'cursor-grabbing select-none',
        className,
      )}
      style={{ maskImage: mask, WebkitMaskImage: mask, ...style }}
      {...props}
    >
      {children}
    </div>
  )
}
