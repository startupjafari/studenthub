import type { AssignmentItem } from '../model/types'

// Статус задания глазами студента (агрегирует статус сдачи + срок). Доменная логика —
// в entity, чтобы переиспользовать в «Задания»/«Мои задачи»/«Сегодня»/«Календарь».
export type StudentAssignmentStatus =
  'NOT_STARTED' | 'DRAFT' | 'SUBMITTED' | 'GRADED' | 'RETURNED' | 'OVERDUE'

export function studentAssignmentStatus(
  a: AssignmentItem,
  now = new Date(),
): StudentAssignmentStatus {
  const sub = a.mySubmission
  const overdue = a.dueAt != null && new Date(a.dueAt) < now && !a.allowLate
  if (sub) {
    if (sub.status === 'SUBMITTED') return 'SUBMITTED'
    if (sub.status === 'GRADED') return 'GRADED'
    if (sub.status === 'RETURNED') return 'RETURNED'
    return overdue ? 'OVERDUE' : 'DRAFT'
  }
  return overdue ? 'OVERDUE' : 'NOT_STARTED'
}
