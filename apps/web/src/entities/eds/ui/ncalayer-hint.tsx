'use client'

import { useTranslations } from 'next-intl'
import { ExternalLink, TriangleAlert } from 'lucide-react'
import { NCALAYER_DOWNLOAD_URL } from '../../../shared/lib/ncalayer'
import { Alert, AlertDescription, AlertTitle } from '../../../shared/ui'
import type { NcaLayerSetupProblem } from '../lib/ncalayer-errors'

/**
 * Подсказка, когда до NCALayer не достучаться: не запущен, запрещён браузером или устарел.
 * Остаётся на экране до следующей попытки — инструкцию читают, переключаясь в трей и
 * обратно, а тост за это время исчезнет.
 */
export function NcaLayerHint({ problem }: { problem: NcaLayerSetupProblem }) {
  const t = useTranslations('Auth')
  const title =
    problem === 'blocked'
      ? t('edsBlockedTitle')
      : problem === 'outdated'
        ? t('edsOutdatedTitle')
        : t('edsNotRunningTitle')
  const text =
    problem === 'blocked'
      ? t('edsBlocked')
      : problem === 'outdated'
        ? t('edsOutdated')
        : t('edsNotRunning')

  return (
    <Alert variant="warning">
      <TriangleAlert aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{text}</p>
        {/* Запрет браузера чинится в его настройках — скачивать NCALayer заново незачем. */}
        {problem !== 'blocked' && (
          <a
            href={NCALAYER_DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            {t('edsDownload')}
            <ExternalLink className="size-3.5 shrink-0" aria-hidden />
          </a>
        )}
      </AlertDescription>
    </Alert>
  )
}
