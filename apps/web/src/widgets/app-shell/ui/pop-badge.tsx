'use client'

import { useBumpKey } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { badgeText } from '../lib/use-nav-badges'

/**
 * Число на бейдже навигации: при росте коротко «щёлкает» (sh-badge-pop), чтобы новое
 * уведомление или сообщение было заметно глазом. Убывание (прочитали) бейдж не дёргает.
 */
export function PopBadge({
  count,
  className,
  label,
}: {
  count: number
  className: string
  /** Подпись для читалки; без неё бейдж декоративный (число уже есть в подписи кнопки). */
  label?: string
}) {
  const bump = useBumpKey(count)
  if (count <= 0) return null
  return (
    <span
      key={bump}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(className, bump > 0 && 'sh-badge-pop')}
    >
      {badgeText(count)}
    </span>
  )
}
