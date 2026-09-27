'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { TriangleAlert } from 'lucide-react'
import * as Sentry from '@sentry/nextjs'
import { StatusScreen } from './status-screen'
import { isChunkLoadError, recoverFromChunkError } from '../lib/use-sw-update'

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
    // Кусок сборки не загрузился (после деплоя или пересборки dev-сервера у открытой
    // вкладки старые адреса) — это не поломка, а устаревшая страница: перезагружаемся, а не
    // показываем красный экран и не шумим в Sentry. В перезагрузку не ушли (только что уже
    // перезагружались) — значит, дело серьёзнее: экран и отчёт, как у любой ошибки.
    if (isChunkLoadError(error) && recoverFromChunkError()) return
    Sentry.captureException(error, {
      tags: { source: 'error-boundary', ...(error.digest ? { next_digest: error.digest } : {}) },
    })
  }, [error])

  return (
    <StatusScreen
      icon={TriangleAlert}
      title={t('error')}
      description={t('errorDesc')}
      // digest показываем человеку: это единственная ниточка между тем, что он видел,
      // и записью в Sentry. Без неё обращение в поддержку звучит как «у меня всё сломалось».
      detail={error.digest ? { label: t('errorCode'), value: error.digest } : undefined}
      onRetry={reset}
      showHome
    />
  )
}
