// Типы домена «Дисциплины» — зеркало ответов API (GET /courses, /subjects, /terms).

export interface CourseSubjectRef {
  id: string
  name: string
  code: string | null
}

export interface CourseGroupRef {
  id: string
  name: string
}

export interface CourseTeacherRef {
  id: string
  firstName: string
  lastName: string
}

export interface CourseTermRef {
  id: string
  name: string
  number: number | null
  isActive: boolean
}

export interface CourseItem {
  id: string
  credits: number | null
  createdAt: string
  subject: CourseSubjectRef
  group: CourseGroupRef
  teacher: CourseTeacherRef | null
  term: CourseTermRef | null
}

export interface SubjectItem {
  id: string
  universityId: string
  name: string
  code: string | null
  createdAt: string
}

export interface TermItem {
  id: string
  universityId: string
  name: string
  number: number | null
  startsOn: string
  endsOn: string
  isActive: boolean
}
