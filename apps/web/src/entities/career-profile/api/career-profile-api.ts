import type { SetCareerConsentInput, UpdateCareerProfileInput } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { CandidateCard, CareerProfile } from '../model/types'

export const careerProfileKeys = {
  all: ['career-profile'] as const,
  mine: () => ['career-profile', 'mine'] as const,
  candidate: (id: string) => ['career-profile', 'candidate', id] as const,
}

export async function fetchMyCareerProfile(): Promise<CareerProfile> {
  const { data } = await api.get<CareerProfile>('/career/profile')
  return data
}

export async function updateMyCareerProfile(
  input: UpdateCareerProfileInput,
): Promise<CareerProfile> {
  const { data } = await api.patch<CareerProfile>('/career/profile', input)
  return data
}

export async function setCareerConsent(input: SetCareerConsentInput): Promise<CareerProfile> {
  const { data } = await api.post<CareerProfile>('/career/profile/consents', input)
  return data
}

/** Открыть скрытый профиль компании, куда был отклик (21.D1). */
export async function shareProfileWithCompany(companyId: string): Promise<void> {
  await api.put(`/career/profile/grants/${companyId}`)
}

/** Закрыть профиль, открытый компании адресно. Действует сразу. */
export async function unshareProfileWithCompany(companyId: string): Promise<void> {
  await api.delete(`/career/profile/grants/${companyId}`)
}

/** Карточка кандидата для работодателя: допуск к вузу и открытый профиль проверяет сервер. */
export async function fetchCandidateCard(studentId: string): Promise<CandidateCard> {
  const { data } = await api.get<CandidateCard>(`/career/profile/candidates/${studentId}`)
  return data
}
