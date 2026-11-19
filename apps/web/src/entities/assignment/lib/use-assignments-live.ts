'use client'

import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { useLiveRefresh } from '../../../shared/realtime'
import { assignmentKeys } from '../api/assignment-api'

/**
 * Живые задания (docs/PROJECT.md §9.2d, `assignment.changed`).
 *
 * Сервер шлёт сигнал группе курса, когда задание выдали или изменили, преподавателю — когда
 * студент сдал работу, студенту — когда работу проверили. В сигнале нет содержимого, поэтому
 * перечитывается вся ветка `assignments`: списки студента и преподавателя, очередь проверки,
 * открытая деталь и сдачи. Перезапросятся только запросы на экране — остальные лишь помечаются
 * устаревшими. Своих сигналов клиент не получает: адресат всегда другая сторона.
 */
export function useAssignmentsLive(enabled = true): void {
  useLiveRefresh(REALTIME_EVENTS.assignmentChanged, [assignmentKeys.all], { enabled })
}
