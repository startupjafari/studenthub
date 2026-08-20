'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { TriangleAlert } from 'lucide-react'
import * as Sentry from '@sentry/nextjs'
import { StatusScreen } from './status-screen'

// Единый error-boundary для всех сегментов (§2.2). До Ф13.8 каждый из 32 error.tsx
// показывал экран и молча выбрасывал `error` — исключение умирало в браузере студента.
// Теперь оно уходит в Sentry, а пользователь видит тот же экран с «Повторить».
export function ErrorScreen({
  error,
  reset,
}: {
  // digest проставляет Next для ошибок серверного рендера: по нему клиентское
  // событие сшивается с серверным (там сообщение не маскируется).
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('Common')

  useEffect(() => {
    Sentry.captureException(error, {
      tags: { source: 'error-boundary', ...(error.digest ? { next_digest: error.digest } : {}) },
    })
  }, [error])

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
