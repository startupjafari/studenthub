import type {
  CreateUniversityInput,
  UniversityListQueryInput,
  UniversityStatusValue,
  UpdateUniversityInput,
} from '@studenthub/shared-schemas'
import { api, getPaged } from '../../../shared/api'
import type { Paged } from '../../../shared/api'

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
  // Параметры — часть ключа: страница, поиск и порядок задают разные выборки, и кэш
  // не должен выдавать одну за другую.
  list: (query: Partial<UniversityListQueryInput> = {}) => ['university', 'list', query] as const,
  detail: (id: string) => ['university', id] as const,
  stats: (id: string) => ['university', id, 'stats'] as const,
}

/**
 * Страница списка вузов: поиск, отбор, сортировка и пагинация считаются на сервере.
 *
 * Раньше здесь стоял зашитый `limit: 100`, а `meta.total` отбрасывался — при 200 вузах
 * админка показывала первую сотню и подписывала её «Вузов: 100», то есть молча врала.
 */
export async function fetchUniversities(
  query: Partial<UniversityListQueryInput> = {},
): Promise<Paged<University>> {
  return getPaged<University>('/universities', { page: 1, limit: 20, ...query })
}

export async function fetchUniversity(id: string): Promise<University> {
  const { data } = await api.get<University>(`/universities/${id}`)
  return data
}

export async function createUniversityRequest(input: CreateUniversityInput): Promise<University> {
  const { data } = await api.post<University>('/universities', input)
  return data
}

export async function updateUniversityRequest(
  id: string,
  input: UpdateUniversityInput,
): Promise<University> {
  const { data } = await api.patch<University>(`/universities/${id}`, input)
  return data
}

// Удаляется только пустой вуз: с факультетами, аудиториями или людьми сервер отвечает CONFLICT.
export async function deleteUniversityRequest(id: string): Promise<void> {
  await api.delete(`/universities/${id}`)
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
