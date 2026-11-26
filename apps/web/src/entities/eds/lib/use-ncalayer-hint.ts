'use client'

import { useCallback, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { NCALAYER_DOWNLOAD_URL } from '../../../shared/lib/ncalayer'
import type { NcaLayerSetupProblem } from './ncalayer-errors'

// Инструкцию читают, переключаясь в трей и обратно, — обычных четырёх секунд на это мало.
const HINT_DURATION_MS = 15_000

/**
 * Подсказка, когда до NCALayer не достучаться: не запущен, запрещён браузером или устарел.
 * Это технический сбой, поэтому тост, а не плашка в окне (DESIGN_SYSTEM §9): блок
 * раздвигал бы окно входа и привязки между попытками.
 *
 * `id` — тот же, что у остальных отказов формы: новая попытка обновляет один тост, а не
 * копит стопку.
 */
export function useNcaLayerHint(id: string): { show: (problem: NcaLayerSetupProblem) => void } {
  const t = useTranslations('Auth')

  const show = useCallback(
    (problem: NcaLayerSetupProblem) => {
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
      toast.warning(title, {
        id,
        description: text,
        duration: HINT_DURATION_MS,
        // Запрет браузера чинится в его настройках — скачивать NCALayer заново незачем.
        action:
          problem === 'blocked'
            ? undefined
            : {
                label: t('edsDownload'),
                onClick: () => window.open(NCALAYER_DOWNLOAD_URL, '_blank', 'noopener,noreferrer'),
              },
      })
    },
    [id, t],
  )

  // Ушли со страницы или закрыли окно — подсказка о нём уходит следом (как в useErrorToast).
  useEffect(
    () => () => {
      toast.dismiss(id)
    },
    [id],
  )

  return { show }
}
