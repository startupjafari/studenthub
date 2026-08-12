import type { Role } from '@studenthub/shared-types'

export interface SearchPerson {
  id: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  role: Role
}
export interface SearchCourse {
  id: string
  subject: { name: string }
  group: { name: string }
}
export interface SearchAssignment {
  id: string
  title: string
  course: { subject: { name: string } }
}
export interface SearchMaterial {
  id: string
  title: string
  subject: string | null
}
export interface SearchResults {
  people: SearchPerson[]
  courses: SearchCourse[]
  assignments: SearchAssignment[]
  materials: SearchMaterial[]
}
