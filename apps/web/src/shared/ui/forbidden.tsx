'use client'

import { useTranslations } from 'next-intl'
import { ShieldAlert } from 'lucide-react'
import { StatusScreen } from './status-screen'

// Экран 403 (недостаточно прав по роли).
export function Forbidden() {
  const t = useTranslations('Common')
  return (
    <StatusScreen
      code="403"
      icon={ShieldAlert}
      title={t('forbidden')}
      description={t('forbiddenDesc')}
      showHome
      showBack
    />
  )
}
