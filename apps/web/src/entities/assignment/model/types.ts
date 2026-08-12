import type { AssignmentStatus, SubmissionStatus } from '@studenthub/shared-schemas'

// Типы домена «Задания» — зеркало ответов API (GET /assignments, /submissions).
export type { AssignmentStatus, SubmissionStatus }

export interface UserRef {
  id: string
  firstName: string
  lastName: string
}

export interface AssignmentCourseRef {
  id: string
  groupId: string
  teacherId: string | null
  subject: { id: string; name: string }
  group: { id: string; name: string }
}

export interface SubmissionItem {
  id: string
  status: SubmissionStatus
  text: string | null
  linkUrl: string | null
  attemptNumber: number
  score: number | null
  feedback: string | null
  submittedAt: string | null
  gradedAt: string | null
  createdAt: string
  student: UserRef
  gradedBy: UserRef | null
}

export interface AssignmentItem {
  id: string
  title: string
  description: string | null
  type: string
  submissionType: string
  status: AssignmentStatus
  maxScore: number | null
  maxAttempts: number | null
  allowLate: boolean
  publishAt: string | null
  dueAt: string | null
  createdAt: string
  course: AssignmentCourseRef
  createdBy: UserRef
  // Только для студента — его собственная сдача (или null).
  mySubmission?: SubmissionItem | null
}
