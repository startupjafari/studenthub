import {
  studentAssignmentStatus,
  type AssignmentItem,
  type StudentAssignmentStatus,
} from '../../../entities/assignment'

// Презентация статуса задания студента. Доменная деривация — в entity
// (studentAssignmentStatus); здесь только маппинг на Badge/i18n.
export type StudentStatus = StudentAssignmentStatus
export const studentStatus = studentAssignmentStatus

export const STUDENT_STATUS_BADGE: Record<
  StudentStatus,
  'secondary' | 'outline' | 'info' | 'success' | 'warning' | 'destructive'
> = {
  NOT_STARTED: 'secondary',
  DRAFT: 'outline',
  SUBMITTED: 'info',
  GRADED: 'success',
  RETURNED: 'warning',
  OVERDUE: 'destructive',
  CLOSED: 'secondary',
}

export const STUDENT_STATUS_KEY: Record<StudentStatus, string> = {
  NOT_STARTED: 'status.notStarted',
  DRAFT: 'status.draft',
  SUBMITTED: 'status.submitted',
  GRADED: 'status.graded',
  RETURNED: 'status.returned',
  OVERDUE: 'status.overdue',
  CLOSED: 'status.closed',
}

// Можно ли редактировать/отправлять работу: задание опубликовано, работа — черновик или
// возвращена. Срок держит только первую сдачу: после него без «поздней сдачи» сервер
// отвечает 409, а возвращённую на доработку принимает и после срока.
export function canEditSubmission(a: AssignmentItem, now = new Date()): boolean {
  const s = a.mySubmission?.status
  if (a.status !== 'PUBLISHED') return false
  if (s === 'RETURNED') return true
  if (s !== undefined && s !== 'DRAFT') return false
  return !(a.dueAt != null && new Date(a.dueAt) < now && !a.allowLate)
}
