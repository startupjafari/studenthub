import type { QueryKey } from '@tanstack/react-query'
import { scheduleKeys, type ScheduleChange } from '../../../entities/schedule'

// Payload WS `schedule:changed` (docs/PROJECT.md §9): разовое изменение пары на дату —
// `{ change, groupId[, removed] }`; правка или удаление пары действующей сетки —
// `{ change: null, groupId, pairId[, removed] }`.
export interface ScheduleChangedPayload {
  change: ScheduleChange | null
  groupId: string
  pairId?: string
  removed?: boolean
}

// Какие запросы перечитать по событию. Разовые изменения — всегда: их выборка лёгкая, а
// при удалении пары уходят и её изменения. Базовую сетку пар (все фильтры `view`) — только
// когда менялась сама пара (`change: null`) или payload не распознан: иначе правка пары у
// студента на экране не появлялась до перезагрузки, хотя тост «изменено» показывался.
// Разовое изменение сетку не трогает — её не перечитываем ради одного наложения.
export function keysToRefreshOnScheduleChanged(payload: unknown): QueryKey[] {
  const keys: QueryKey[] = [scheduleKeys.allChanges]
  const change = (payload as Partial<ScheduleChangedPayload> | null | undefined)?.change
  if (!change) keys.push(scheduleKeys.allViews)
  return keys
}
