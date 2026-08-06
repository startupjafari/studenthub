import type { CreateFacultyInput, UpdateFacultyInput } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'

export interface Faculty {
  id: string
  name: string
  universityId: string
  createdAt: string
}

export const facultyKeys = {
  all: ['faculties'] as const,
  list: (universityId?: string) => ['faculties', 'list', universityId ?? 'own'] as const,
}

// Список факультетов. Для не-платформы сервер сам ограничивает своим вузом (scope).
export async function fetchFaculties(universityId?: string): Promise<Faculty[]> {
  const { data } = await api.get<Faculty[]>('/faculties', {
    params: { page: 1, limit: 100, universityId },
  })
  return data
}

export async function createFacultyRequest(input: CreateFacultyInput): Promise<Faculty> {
  const { data } = await api.post<Faculty>('/faculties', input)
  return data
}

export async function updateFacultyRequest(
  id: string,
  input: UpdateFacultyInput,
): Promise<Faculty> {
  const { data } = await api.patch<Faculty>(`/faculties/${id}`, input)
  return data
}

export async function deleteFacultyRequest(id: string): Promise<void> {
  await api.delete(`/faculties/${id}`)
}
