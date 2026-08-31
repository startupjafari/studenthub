import type { CareerEventListQueryInput } from '@studenthub/shared-schemas'
import { api, getPaged, type Paged } from '../../../shared/api'
import type { CareerEvent, CompanyCareerAnalytics, UniversityCareerAnalytics } from '../model/types'

export const careerEventKeys = {
  all: ['career-event'] as const,
  list: (params: Partial<CareerEventListQueryInput>) => ['career-event', 'list', params] as const,
  universityAnalytics: () => ['career-analytics', 'university'] as const,
  companyAnalytics: () => ['career-analytics', 'company'] as const,
}

export function fetchCareerEvents(
  params: Partial<CareerEventListQueryInput> = {},
): Promise<Paged<CareerEvent>> {
  return getPaged<CareerEvent>('/career/events', { page: 1, limit: 20, ...params })
}

export async function fetchUniversityCareerAnalytics(): Promise<UniversityCareerAnalytics> {
  const { data } = await api.get<UniversityCareerAnalytics>('/career/analytics/university')
  return data
}

export async function fetchCompanyCareerAnalytics(): Promise<CompanyCareerAnalytics> {
  const { data } = await api.get<CompanyCareerAnalytics>('/career/analytics/company')
  return data
}
