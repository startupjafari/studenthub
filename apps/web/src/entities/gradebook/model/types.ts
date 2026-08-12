import type { GradeColumnKind } from '@studenthub/shared-schemas'
export type { GradeColumnKind }

export interface GradeColumnItem {
  id: string
  title: string
  kind: string
  maxScore: number | null
  position: number
  published: boolean
  createdAt: string
}

export interface GradebookStudent {
  id: string
  firstName: string
  lastName: string
}

export interface GradeCell {
  columnId: string
  studentId: string
  score: number | null
}

export interface Gradebook {
  courseId: string
  columns: GradeColumnItem[]
  students: GradebookStudent[]
  grades: GradeCell[]
}

export interface MyGradeColumn {
  id: string
  title: string
  kind: string
  maxScore: number | null
  position: number
  score: number | null
}

export interface MyGradesCourse {
  courseId: string
  subject: { id: string; name: string }
  credits: number | null
  columns: MyGradeColumn[]
}
