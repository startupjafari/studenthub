// Тип ответа BFF-агрегатора «мой день» (GET /me/today, docs/UNIFIED_UX.md PR-1).
// Вложенные коллекции — существующие доменные типы (SSOT в своих сущностях, здесь не дублируются).
import type { Pair, ScheduleChange } from '../../schedule'
import type { ApplicationListItem } from '../../application-service'
import type { EventItem } from '../../event'
import type { AssignmentItem } from '../../assignment'
import type { NotificationItem } from '../../notification'

export interface MeToday {
  role: string
  date: string
  timezone: string | null
  pairs: Pair[]
  scheduleChanges: ScheduleChange[]
  applications: ApplicationListItem[]
  events: EventItem[]
  assignments: AssignmentItem[]
  notifications: NotificationItem[]
}
