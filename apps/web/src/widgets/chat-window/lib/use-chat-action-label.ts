'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import type { ActorsSummary } from './chat-actions'

/**
 * Подпись действия для шапки чата и строки списка.
 *
 * Собирается здесь, а не в двух местах: шапка и список показывают одно и то же и обязаны
 * расходиться только наличием имени. Сервер имён действий не переводит — присылает значение
 * enum, текст берётся из i18n по нему же (`actions.TYPING`), без промежуточного маппинга.
 *
 * `withName` — показывать ли имя. В личном чате оно лишнее (собеседник и так один), в строке
 * списка чатов места на него нет.
 */
export function useChatActionLabel(): (
  summary: ActorsSummary | null,
  opts?: { name?: string; withName?: boolean },
) => string | null {
  const t = useTranslations('Chats')

  return useCallback(
    (summary, opts) => {
      if (!summary) return null
      const name = opts?.withName ? opts.name : undefined

      if (summary.kind === 'single') {
        return name
          ? t(`actionsNamed.${summary.action}`, { name })
          : t(`actions.${summary.action}`, { count: 1 })
      }
      if (summary.kind === 'same') {
        return t(`actions.${summary.action}`, { count: summary.count })
      }
      // Разные действия у разных людей: перечислять их в одну строку негде, а плюрал одного
      // из действий был бы прямой неправдой про остальных.
      return t('actionsMany', { count: summary.count })
    },
    [t],
  )
}
