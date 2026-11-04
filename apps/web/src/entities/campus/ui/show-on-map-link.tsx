'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { MapPin } from 'lucide-react'
import { cn } from '../../../shared/lib'

/**
 * «Показать на карте» (§17): ссылка на мост `/campus/room/<id>`, который находит помещение
 * на опубликованной карте. Нет на карте — там же понятная заглушка, поэтому заранее не
 * спрашиваем сервер (иначе каждая пара в расписании стоила бы запроса).
 */
export function ShowOnMapLink({
  roomId,
  variant = 'text',
  className,
}: {
  roomId: string
  /** `text` — подпись со значком, `icon` — только значок (плотные таблицы). */
  variant?: 'text' | 'icon'
  className?: string
}) {
  const t = useTranslations('CampusMap')
  return (
    <Link
      href={`/campus/room/${roomId}`}
      aria-label={variant === 'icon' ? t('showOnMap') : undefined}
      title={variant === 'icon' ? t('showOnMap') : undefined}
      className={cn(
        'inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline',
        'rounded-md focus-visible:ring-4 focus-visible:ring-ring/20 focus-visible:outline-none',
        className,
      )}
    >
      <MapPin className="size-4 shrink-0" aria-hidden />
      {variant === 'text' && t('showOnMap')}
    </Link>
  )
}
