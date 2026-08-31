import type {
  DecideVacancyInput,
  UpdateVacancyInput,
  VacancyInput,
  VacancyReviewQueueInput,
  VacancySearchInput,
} from '@studenthub/shared-schemas'
import { api, getPaged, type Paged } from '../../../shared/api'
import type { EmployerVacancy, Vacancy, VacancyReviewRow } from '../model/types'

export const vacancyKeys = {
  all: ['vacancy'] as const,
  search: (params: Partial<VacancySearchInput>) => ['vacancy', 'search', params] as const,
  byId: (id: string) => ['vacancy', id] as const,
  mine: (page: number) => ['vacancy', 'mine', page] as const,
  reviewQueue: (params: Partial<VacancyReviewQueueInput>) =>
    ['vacancy', 'review-queue', params] as const,
}

// ── Студент ──────────────────────────────────────────────────────────────────

export function searchVacancies(params: Partial<VacancySearchInput> = {}): Promise<Paged<Vacancy>> {
  return getPaged<Vacancy>('/career/vacancies', { page: 1, limit: 20, ...params })
}

export async function fetchVacancy(id: string): Promise<Vacancy> {
  const { data } = await api.get<Vacancy>(`/career/vacancies/${id}`)
  return data
}

// ── Компания ─────────────────────────────────────────────────────────────────

export function fetchMyVacancies(page = 1): Promise<Paged<EmployerVacancy>> {
  return getPaged<EmployerVacancy>('/career/employer/vacancies', { page, limit: 20 })
}

export async function createVacancy(input: VacancyInput): Promise<{ id: string }> {
  const { data } = await api.post<{ id: string }>('/career/employer/vacancies', input)
  return data
}

export async function updateVacancy(id: string, input: UpdateVacancyInput): Promise<void> {
  await api.patch(`/career/employer/vacancies/${id}`, input)
}

export async function publishVacancy(id: string): Promise<void> {
  await api.post(`/career/employer/vacancies/${id}/publish`)
}

export async function pauseVacancy(id: string): Promise<void> {
  await api.post(`/career/employer/vacancies/${id}/pause`)
}

export async function closeVacancy(id: string): Promise<void> {
  await api.post(`/career/employer/vacancies/${id}/close`)
}

// ── Вуз ──────────────────────────────────────────────────────────────────────

export function fetchVacancyReviewQueue(
  params: Partial<VacancyReviewQueueInput> = {},
): Promise<Paged<VacancyReviewRow>> {
  return getPaged<VacancyReviewRow>('/career/university/vacancies', {
    page: 1,
    limit: 20,
    ...params,
  })
}

export async function decideVacancyReview(id: string, input: DecideVacancyInput): Promise<void> {
  await api.patch(`/career/university/vacancies/${id}`, input)
}
