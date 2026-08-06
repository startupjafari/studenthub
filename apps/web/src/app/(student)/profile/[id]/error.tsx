'use client'

import { useTranslations } from 'next-intl'
import { TriangleAlert } from 'lucide-react'
import { StatusScreen } from '../../../../shared/ui'

// error.tsx обязателен для каждого сегмента (§2.2). Всегда клиентский компонент.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('Common')
  return (
    <StatusScreen
      icon={TriangleAlert}
      title={t('error')}
      description={t('errorDesc')}
      onRetry={reset}
      showHome
    />
  )
}
