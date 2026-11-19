'use client'

import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { useLiveRefresh } from '../../../shared/realtime'
import { examKeys } from '../api/exam-api'

/**
 * Живые экзамены (docs/PROJECT.md §9.2d, `exam.changed`).
 *
 * Сервер шлёт сигнал группе экзамена и личным комнатам ведущего дисциплину и экзаменатора,
 * когда экзамен назначили, перенесли, изменили или отменили, и студентам, чьи строки
 * ведомости изменились. В сигнале нет содержимого, поэтому перечитывается вся ветка `exams`:
 * списки любого экрана (студент, преподаватель, деканат, календарь, учебный план) и открытая
 * ведомость. Перезапросятся только запросы на экране — остальные лишь помечаются устаревшими.
 */
export function useExamsLive(enabled = true): void {
  useLiveRefresh(REALTIME_EVENTS.examChanged, [examKeys.all], { enabled })
}
