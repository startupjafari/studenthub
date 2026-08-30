import type { SetCareerConsentInput, UpdateCareerProfileInput } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { CareerProfile } from '../model/types'

export const careerProfileKeys = {
  all: ['career-profile'] as const,
  mine: () => ['career-profile', 'mine'] as const,
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
