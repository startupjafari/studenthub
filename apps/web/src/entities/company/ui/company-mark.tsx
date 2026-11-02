'use client'

import { useTranslations } from 'next-intl'
import { Building2 } from 'lucide-react'
import { Badge } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

/** Страница компании в вебе — туда ведут пометки на её контенте и уведомления. */
export function companyPath(companyId: string): string {
  return `/companies/${companyId}`
}

interface CompanyMarkProps {
  className?: string
}

/**
 * Пометка «от имени компании» на посте, статье или опросе её страницы: автор — сотрудник,
 * а говорит компания. Без пометки такой контент читался бы как личный пост человека.
 */
export function CompanyMark({ className }: CompanyMarkProps) {
  const t = useTranslations('Company')
  return (
    <Badge variant="info" className={cn('shrink-0', className)}>
      <Building2 className="size-3" aria-hidden />
      {t('mark')}
    </Badge>
  )
}
