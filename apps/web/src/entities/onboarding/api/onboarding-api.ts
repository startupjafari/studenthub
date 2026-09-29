import type {
  ApproveDemoRequestInput,
  DemoRequestListQueryInput,
  RejectDemoRequestInput,
  SkipOnboardingStepInput,
  SubmitDemoRequestInput,
} from '@studenthub/shared-schemas'
import { api, getPaged, type Paged } from '../../../shared/api'
import type { DemoRequest, OnboardingState } from '../model/types'

export const onboardingKeys = {
  all: ['onboarding'] as const,
  state: () => ['onboarding', 'state'] as const,
  demoRequests: (params: Partial<DemoRequestListQueryInput> = {}) =>
    ['onboarding', 'demo-requests', params] as const,
  demoRequest: (id: string) => ['onboarding', 'demo-requests', id] as const,
}

// ── Публичное: заявка и подтверждение адреса ─────────────────────────────────

export async function submitDemoRequest(input: SubmitDemoRequestInput): Promise<{ email: string }> {
  const { data } = await api.post<{ email: string }>('/demo-requests', input)
  return data
}

export async function verifyDemoRequest(token: string): Promise<{ status: 'NEW' }> {
  const { data } = await api.post<{ status: 'NEW' }>('/demo-requests/verify', { token })
  return data
}

// ── Очередь модерации (PLATFORM_ADMIN) ───────────────────────────────────────

export function fetchDemoRequests(
  params: Partial<DemoRequestListQueryInput> = {},
): Promise<Paged<DemoRequest>> {
  return getPaged<DemoRequest>('/demo-requests', params)
}

export async function fetchDemoRequest(id: string): Promise<DemoRequest> {
  const { data } = await api.get<DemoRequest>(`/demo-requests/${id}`)
  return data
}

export async function approveDemoRequest(
  id: string,
  input: ApproveDemoRequestInput,
): Promise<DemoRequest> {
  const { data } = await api.post<DemoRequest>(`/demo-requests/${id}/approve`, input)
  return data
}

export async function rejectDemoRequest(
  id: string,
  input: RejectDemoRequestInput,
): Promise<DemoRequest> {
  const { data } = await api.post<DemoRequest>(`/demo-requests/${id}/reject`, input)
  return data
}

// ── Мастер настройки (UNIVERSITY_ADMIN) ──────────────────────────────────────

export async function fetchOnboardingState(): Promise<OnboardingState> {
  const { data } = await api.get<OnboardingState>('/onboarding')
  return data
}

export async function confirmOnboardingProfile(): Promise<OnboardingState> {
  const { data } = await api.post<OnboardingState>('/onboarding/confirm-profile')
  return data
}

export async function skipOnboardingStep(input: SkipOnboardingStepInput): Promise<OnboardingState> {
  const { data } = await api.post<OnboardingState>('/onboarding/skip', input)
  return data
}

export async function dismissOnboarding(): Promise<OnboardingState> {
  const { data } = await api.post<OnboardingState>('/onboarding/dismiss')
  return data
}

export async function launchUniversity(): Promise<OnboardingState> {
  const { data } = await api.post<OnboardingState>('/onboarding/launch')
  return data
}
