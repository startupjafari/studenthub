import type { AssignmentItem } from '../model/types'

// Статус задания глазами студента (агрегирует статус сдачи + срок). Доменная логика —
// в entity, чтобы переиспользовать в «Задания»/«Мои задачи»/«Сегодня»/«Календарь».
export type StudentAssignmentStatus =
  'NOT_STARTED' | 'DRAFT' | 'SUBMITTED' | 'GRADED' | 'RETURNED' | 'OVERDUE' | 'CLOSED'

export function studentAssignmentStatus(
  a: AssignmentItem,
  now = new Date(),
): StudentAssignmentStatus {
  const sub = a.mySubmission
  if (sub?.status === 'SUBMITTED') return 'SUBMITTED'
  if (sub?.status === 'GRADED') return 'GRADED'
  // Закрытое задание работ больше не принимает: несданное по нему — не «не начато» и не
  // задача на сегодня, сдать его уже нельзя (сервер отвечает 409).
  if (a.status === 'CLOSED') return 'CLOSED'
  if (sub?.status === 'RETURNED') return 'RETURNED'
  const overdue = a.dueAt != null && new Date(a.dueAt) < now && !a.allowLate
  if (sub) return overdue ? 'OVERDUE' : 'DRAFT'
  return overdue ? 'OVERDUE' : 'NOT_STARTED'
}
