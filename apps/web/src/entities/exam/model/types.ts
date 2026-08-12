import type { ExamFormat, ExamResultStatus } from '@studenthub/shared-schemas'
export type { ExamFormat, ExamResultStatus }

export interface UserRef {
  id: string
  firstName: string
  lastName: string
}

export interface ExamResultMini {
  id: string
  admitted: boolean
  status: ExamResultStatus
  score: number | null
  attempt: number
  note: string | null
  student: UserRef
}

export interface ExamItem {
  id: string
  date: string
  format: string
  maxScore: number | null
  note: string | null
  createdAt: string
  groupId: string
  course: { id: string; teacherId: string | null; subject: { id: string; name: string } }
  group: { id: string; name: string }
  room: { id: string; name: string } | null
  examiner: UserRef | null
  myResult?: ExamResultMini | null
}

export interface ExamRosterEntry {
  studentId: string
  firstName: string
  lastName: string
  admitted: boolean
  status: ExamResultStatus
  score: number | null
  attempt: number
  note: string | null
}

export interface ExamRoster {
  examId: string
  students: ExamRosterEntry[]
}
