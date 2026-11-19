'use client'

import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { useLiveRefresh } from '../../../shared/realtime'
import { attendanceKeys } from '../api/attendance-api'

/**
 * Живая посещаемость студента (docs/PROJECT.md §9.2d, `attendance.changed`).
 *
 * Сервер шлёт сигнал только тем студентам, чью отметку преподаватель поменял. Перечитываются
 * все сводки «моей» посещаемости — общая и по дисциплинам: `attendanceKeys.me()` без фильтра
 * совпадает префиксом с любым `me(query)` (пустой объект в ключе — частичное совпадение).
 */
export function useAttendanceLive(enabled = true): void {
  useLiveRefresh(REALTIME_EVENTS.attendanceChanged, [attendanceKeys.me()], { enabled })
}
