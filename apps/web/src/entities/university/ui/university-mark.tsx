'use client'

import { useTranslations } from 'next-intl'
import { GraduationCap } from 'lucide-react'
import { Badge } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

/** Страница университета в вебе — туда ведут пометки на его контенте и уведомления. */
export function universityPath(universityId: string): string {
  return `/universities/${universityId}`
}

/**
 * Пометка «от имени университета» на посте, статье или опросе страницы вуза: автор — админ
 * или модератор, а говорит вуз. Без неё объявление вуза читалось бы как личный пост.
 */
export function UniversityMark({ className }: { className?: string }) {
  const t = useTranslations('University')
  return (
    <Badge variant="default" className={cn('shrink-0', className)}>
      <GraduationCap className="size-3" aria-hidden />
      {t('mark')}
    </Badge>
  )
}
