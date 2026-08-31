// Типы домена «Вакансии» — зеркало ответов API (GET /career/vacancies).
import type {
  EmploymentType,
  ExperienceLevel,
  MatchResult,
  VacancyReviewStatus,
  VacancyStatus,
  WorkFormat,
} from '@studenthub/shared-schemas'

export interface VacancyCompany {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  city: string | null
}

/** Вакансия так, как её видит студент. */
export interface Vacancy {
  id: string
  title: string
  description: string
  employmentType: EmploymentType
  workFormat: WorkFormat
  experienceLevel: ExperienceLevel
  city: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  skills: string[]
  languages: string[]
  deadline: string | null
  publishedAt: string | null
  company: VacancyCompany
  /** Совпадение с карьерным профилем. null — профиль ещё не заполнен. */
  match: MatchResult | null
}

/** Решение конкретного вуза по вакансии. */
export interface VacancyReview {
  status: VacancyReviewStatus
  reason: string | null
  university: { id: string; name: string }
}

/** Вакансия глазами компании: со статусом и решениями вузов. */
export interface EmployerVacancy extends Omit<Vacancy, 'match'> {
  status: VacancyStatus
  views: number
  createdAt: string
  reviews: VacancyReview[]
}

/** Строка очереди модерации у вуза. */
export interface VacancyReviewRow {
  id: string
  status: VacancyReviewStatus
  reason: string | null
  createdAt: string
  decidedAt: string | null
  vacancy: Omit<Vacancy, 'match'>
}
