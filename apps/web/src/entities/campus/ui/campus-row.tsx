'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight, Map as MapIcon } from 'lucide-react'
import { Card } from '../../../shared/ui'

/**
 * Строка кампуса в списке — системный row-card (DESIGN_SYSTEM §10.2): чип-иконка, название,
 * строка пояснения, статус, шеврон перехода. Одна и та же у администратора и у зрителя.
 */
export function CampusRow({
  href,
  name,
  meta,
  badge,
}: {
  href: string
  name: string
  meta: ReactNode
  badge?: ReactNode
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <Card className="flex-row items-center gap-3 p-4 transition-colors duration-150 hover:bg-muted/40">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <MapIcon className="size-5" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate font-medium">{name}</span>
          <span className="truncate text-xs text-muted-foreground">{meta}</span>
        </div>
        {badge}
        <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      </Card>
    </Link>
  )
}
