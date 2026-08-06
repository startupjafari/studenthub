import type { CreateUniversityInput, UniversityStatusValue } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'

export interface University {
  id: string
  name: string
  shortName: string | null
  status: 'PENDING' | 'ACTIVE' | 'BLOCKED'
  country: string | null
  city: string | null
  timezone: string
  createdAt: string
}

export interface UniversityStats {
  faculties: number
  groups: number
  rooms: number
  students: number
  teachers: number
}

export const universityKeys = {
  all: ['university'] as const,
  list: () => ['university', 'list'] as const,
  detail: (id: string) => ['university', id] as const,
  stats: (id: string) => ['university', id, 'stats'] as const,
}

export async function fetchUniversities(): Promise<University[]> {
  const { data } = await api.get<University[]>('/universities', { params: { page: 1, limit: 100 } })
  return data
}

export async function fetchUniversity(id: string): Promise<University> {
  const { data } = await api.get<University>(`/universities/${id}`)
  return data
}

export async function createUniversityRequest(input: CreateUniversityInput): Promise<University> {
  const { data } = await api.post<University>('/universities', input)
  return data
}

export async function setUniversityStatusRequest(
  id: string,
  status: UniversityStatusValue,
): Promise<University> {
  const { data } = await api.patch<University>(`/universities/${id}/status`, { status })
  return data
}

export async function fetchUniversityStats(id: string): Promise<UniversityStats> {
  const { data } = await api.get<UniversityStats>(`/universities/${id}/stats`)
  return data
}
