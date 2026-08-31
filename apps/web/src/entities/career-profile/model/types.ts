// Типы домена «Карьерный профиль» — зеркало ответов API (GET /career/profile).
import type {
  CareerVisibility,
  ConsentField,
  EmploymentStatus,
  EmploymentType,
  ReadinessBreakdown,
  WorkFormat,
} from '@studenthub/shared-schemas'

export interface CareerConsent {
  field: ConsentField
  companyId: string | null
  grantedAt: string
}

/** Поля, которые студент не редактирует здесь: они приходят из профиля вуза. */
export interface InheritedProfile {
  firstName: string
  lastName: string
  headline: string | null
  city: string | null
  specialty: string | null
  course: number | null
  graduationYear: number | null
  skills: string[]
  languages: string[]
  universityName: string | null
  portfolioCount: number
}

export interface CareerProfile {
  visibility: CareerVisibility
  employmentStatus: EmploymentStatus
  desiredPositions: string[]
  employmentTypes: EmploymentType[]
  workFormats: WorkFormat[]
  relocationReady: boolean
  desiredSalaryMin: number | null
  desiredSalaryMax: number | null
  salaryCurrency: string | null
  about: string | null
  readiness: ReadinessBreakdown
  consents: CareerConsent[]
  inherited: InheritedProfile
}
