'use client'

import { useTranslations } from 'next-intl'
import { CloudOff } from 'lucide-react'
import { Button, EmptyState } from '../../../shared/ui'

/**
 * Вкладка профиля не загрузилась, и повторы прекращены (см. useRetryOnError): ошибка на
 * месте содержимого с кнопкой повтора — вместо вечного скелетона и тоста каждые 5 секунд.
 */
export function LoadFailed({
  onRetry,
  busy,
  compact = false,
}: {
  onRetry: () => void
  busy: boolean
  // Под уже показанным списком (не догрузилась следующая страница) — без высоты экрана.
  compact?: boolean
}) {
  const t = useTranslations('Profile')
  const tCommon = useTranslations('Common')
  return (
    <EmptyState
      icon={<CloudOff className="size-6" aria-hidden />}
      title={t('loadFailed')}
      action={
        <Button variant="outline" loading={busy} onClick={onRetry}>
          {tCommon('retry')}
        </Button>
      }
      className={compact ? 'mt-4' : 'min-h-[calc(100dvh_-_20rem)]'}
    />
  )
}
