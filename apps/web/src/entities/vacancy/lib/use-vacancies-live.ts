'use client'

import { REALTIME_EVENTS, type RealtimeEnvelope } from '@studenthub/shared-schemas'
import { useLiveRefresh } from '../../../shared/realtime'
import { vacancyKeys } from '../api/vacancy-api'

/**
 * Живые вакансии (docs/PROJECT.md §9.2d, `career.changed` с `entity: 'vacancy'`).
 *
 * Сервер шлёт сигнал вузам, куда допущена компания, и её участникам, когда вакансию
 * опубликовали, изменили, сняли или закрыли, и вузу решения с компанией — когда модератор
 * её одобрил или отклонил. Черновики — только компании. В сигнале нет содержимого, поэтому
 * перечитывается вся ветка `vacancy`: витрина и карточка студента, кабинет компании и
 * очередь модерации — каждый получит строки по своим правам. Сигналы откликов
 * (`entity: 'application'`) этот хук пропускает — их слушает `useCareerApplicationsLive`.
 */
export function useVacanciesLive(enabled = true): void {
  useLiveRefresh(
    REALTIME_EVENTS.careerChanged,
    (envelope: RealtimeEnvelope) =>
      (envelope.data as { entity?: string } | null)?.entity === 'vacancy'
        ? [vacancyKeys.all]
        : null,
    { enabled },
  )
}
