// Типы карьерных мероприятий — зеркало ответов API (GET /career/events).
import type { CareerEventKind } from '@studenthub/shared-schemas'

export interface CareerEvent {
  id: string
  careerKind: CareerEventKind | null
  title: string
  description: string
  location: string | null
  isOnline: boolean
  startsAt: string
  endsAt: string | null
  organizer: { id: string; firstName: string; lastName: string }
  registered: boolean
  participantsCount: number
}

/** Сводка карьерного модуля для вуза. Только агрегаты — персональных данных здесь нет. */
export interface UniversityCareerAnalytics {
  companies: Record<string, number>
  vacancies: Record<string, number>
  funnel: Record<string, number>
  profiles: { visible: number; total: number }
  rates: { interview: number | null; offer: number | null; hired: number | null }
}

/** Сводка подбора для компании. */
export interface CompanyCareerAnalytics {
  vacancies: Record<string, number>
  funnel: Record<string, number>
  views: number
  rates: { apply: number | null; interview: number | null; hired: number | null }
}
