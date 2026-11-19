'use client'

import { REALTIME_EVENTS, type RealtimeEnvelope } from '@studenthub/shared-schemas'
import { useLiveRefresh } from '../../../shared/realtime'
import { applicationKeys } from '../api/career-application-api'

/**
 * Живые отклики (docs/PROJECT.md §9.2d, `career.changed` с `entity: 'application'`).
 *
 * Сервер шлёт сигнал участникам компании, когда студент откликнулся или отозвал отклик, а
 * когда компания перевела отклик по воронке — его автору и коллегам по компании. В сигнале
 * нет содержимого, поэтому перечитывается вся ветка `career-application`: «Мои отклики»,
 * воронка кандидатов и история открытого отклика. Сигналы вакансий этот хук пропускает.
 */
export function useCareerApplicationsLive(enabled = true): void {
  useLiveRefresh(
    REALTIME_EVENTS.careerChanged,
    (envelope: RealtimeEnvelope) =>
      (envelope.data as { entity?: string } | null)?.entity === 'application'
        ? [applicationKeys.all]
        : null,
    { enabled },
  )
}
