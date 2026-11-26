'use client'

import { useTranslations } from 'next-intl'
import type { NcaLayerErrorKind } from '../../../shared/lib/ncalayer'

/** Проблемы установки, которые человек чинит у себя: им нужна подсказка на месте, не тост. */
export type NcaLayerSetupProblem = Extract<
  NcaLayerErrorKind,
  'not-running' | 'blocked' | 'outdated'
>

export function isNcaLayerSetupProblem(kind: NcaLayerErrorKind): kind is NcaLayerSetupProblem {
  return kind === 'not-running' || kind === 'blocked' || kind === 'outdated'
}

/**
 * Текст отказа NCALayer для тоста. `null` — отмена: человек сам закрыл окно выбора ключа, и
 * сообщать ему об этом незачем.
 */
export function useNcaLayerErrorText(): (kind: NcaLayerErrorKind) => string | null {
  const t = useTranslations('Auth')
  return (kind) => {
    switch (kind) {
      case 'cancelled':
        return null
      case 'not-running':
        return t('edsNotRunning')
      case 'blocked':
        return t('edsBlocked')
      case 'outdated':
        return t('edsOutdated')
      case 'busy':
        return t('edsBusy')
      case 'failed':
        return t('edsFailed')
    }
  }
}
