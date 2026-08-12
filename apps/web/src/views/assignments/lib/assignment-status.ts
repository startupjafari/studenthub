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
}

export const STUDENT_STATUS_KEY: Record<StudentStatus, string> = {
  NOT_STARTED: 'status.notStarted',
  DRAFT: 'status.draft',
  SUBMITTED: 'status.submitted',
  GRADED: 'status.graded',
  RETURNED: 'status.returned',
  OVERDUE: 'status.overdue',
}

// Можно ли редактировать/отправлять работу (DRAFT/RETURNED и задание опубликовано).
export function canEditSubmission(a: AssignmentItem): boolean {
  const s = a.mySubmission?.status
  if (a.status !== 'PUBLISHED') return false
  return s === undefined || s === 'DRAFT' || s === 'RETURNED'
}
