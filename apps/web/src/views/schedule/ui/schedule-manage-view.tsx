import { ManageSchedule } from '../../../features/manage-schedule'

// Управление расписанием. admin — декан/админ вуза (контейнеры+пары+замены);
// teacher — преподаватель управляет только своими парами. Тонкая обёртка (FSD: view → feature).
export function ScheduleManageView({ mode = 'admin' }: { mode?: 'admin' | 'teacher' } = {}) {
  return <ManageSchedule mode={mode} />
}
