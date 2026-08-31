// Типы домена «Отклики» — зеркало ответов API (GET /career/applications).
import type {
  CareerApplicationStatus,
  EmploymentType,
  WorkFormat,
} from '@studenthub/shared-schemas'

/** Отклик глазами студента. */
export interface StudentApplication {
  id: string
  status: CareerApplicationStatus
  coverLetter: string | null
  createdAt: string
  updatedAt: string
  vacancy: {
    id: string
    title: string
    employmentType: EmploymentType
    workFormat: WorkFormat
    city: string | null
    company: { id: string; name: string; logoUrl: string | null }
  }
}

/** Кандидат в воронке компании. */
export interface PipelineApplication {
  id: string
  status: CareerApplicationStatus
  coverLetter: string | null
  createdAt: string
  updatedAt: string
  vacancy: { id: string; title: string }
  student: {
    id: string
    firstName: string
    lastName: string
    avatarThumbUrl: string | null
    headline: string | null
    specialty: string | null
    course: number | null
    skills: string[]
  }
}

export interface ApplicationEvent {
  id: string
  fromStatus: CareerApplicationStatus | null
  toStatus: CareerApplicationStatus
  comment: string | null
  createdAt: string
}
