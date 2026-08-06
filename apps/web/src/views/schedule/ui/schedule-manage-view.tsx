import { ManageSchedule } from '../../../features/manage-schedule'

// Управление расписанием (декан/админ вуза). Тонкая обёртка над фичей (FSD: view → feature).
export function ScheduleManageView() {
  return <ManageSchedule />
}
