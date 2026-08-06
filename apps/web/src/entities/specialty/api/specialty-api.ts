import type { CreateSpecialtyInput } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'

export interface Specialty {
  id: string
  name: string
}

export const specialtyKeys = {
  all: ['specialties'] as const,
  list: () => ['specialties', 'list'] as const,
}

// Специальности своего вуза (сервер ограничивает по scope).
export async function fetchSpecialties(): Promise<Specialty[]> {
  const { data } = await api.get<Specialty[]>('/specialties')
  return data
}

export async function createSpecialtyRequest(input: CreateSpecialtyInput): Promise<Specialty> {
  const { data } = await api.post<Specialty>('/specialties', input)
  return data
}

export async function deleteSpecialtyRequest(id: string): Promise<void> {
  await api.delete(`/specialties/${id}`)
}
