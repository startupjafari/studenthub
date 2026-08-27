'use client'

import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from './card'
import { Skeleton } from './skeleton'
import { cn } from '../lib/utils'

/**
 * Плитка показателя: иконка в чипе слева, число и подпись справа.
 *
 * Одна шкала для всех сводок платформы — дашборд вуза, аналитика факультета, обзор
 * документов. Раньше каждый экран собирал её заново: где-то иконка стояла над числом
 * и плитка вырастала вдвое, где-то отличался кегль. Поднята в систему по
 * DESIGN_SYSTEM §17 («нужен такой элемент на новом экране — не копировать»).
 *
 * `tone` красит только чип иконки: число остаётся текстовым токеном, иначе значение
 * начинало бы нести цвет данных. Исключение — `valueTone` для показателя, который
 * сам по себе тревожный (посещаемость ниже порога).
 */
export function MetricTile({
  icon: Icon,
  tone = 'text-primary',
  label,
  value,
  valueTone,
  loading,
}: {
  icon: LucideIcon
  /** Тон чипа иконки — текстовый класс; фон берётся как `bg-current/10`. */
  tone?: string
  label: string
  value: number | string | null
  /** Тон самого числа. По умолчанию — обычный текст. */
  valueTone?: string
  loading?: boolean
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg bg-current/10',
            tone,
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className={cn('block text-xl leading-tight font-semibold tabular-nums', valueTone)}>
            {loading ? <Skeleton className="h-5 w-10" /> : (value ?? '—')}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{label}</span>
        </span>
      </CardContent>
    </Card>
  )
}
