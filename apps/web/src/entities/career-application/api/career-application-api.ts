import type {
  ApplicationListQueryInput,
  ChangeApplicationStatusInput,
  CreateApplicationInput,
} from '@studenthub/shared-schemas'
import { api, getPaged, type Paged } from '../../../shared/api'
import type { ApplicationEvent, PipelineApplication, StudentApplication } from '../model/types'

export const applicationKeys = {
  all: ['career-application'] as const,
  mine: (params: Partial<ApplicationListQueryInput>) =>
    ['career-application', 'mine', params] as const,
  pipeline: (params: Partial<ApplicationListQueryInput>) =>
    ['career-application', 'pipeline', params] as const,
  history: (id: string) => ['career-application', id, 'history'] as const,
}

export function fetchMyApplications(
  params: Partial<ApplicationListQueryInput> = {},
): Promise<Paged<StudentApplication>> {
  return getPaged<StudentApplication>('/career/applications', { page: 1, limit: 20, ...params })
}

export async function applyToVacancy(input: CreateApplicationInput): Promise<{ id: string }> {
  const { data } = await api.post<{ id: string }>('/career/applications', input)
  return data
}

export async function withdrawApplication(id: string): Promise<void> {
  await api.post(`/career/applications/${id}/withdraw`)
}

export async function fetchApplicationHistory(id: string): Promise<ApplicationEvent[]> {
  const { data } = await api.get<ApplicationEvent[]>(`/career/applications/${id}/history`)
  return data
}

export function fetchPipeline(
  params: Partial<ApplicationListQueryInput> = {},
): Promise<Paged<PipelineApplication>> {
  return getPaged<PipelineApplication>('/career/employer/applications', {
    page: 1,
    limit: 20,
    ...params,
  })
}

export async function changeApplicationStatus(
  id: string,
  input: ChangeApplicationStatusInput,
): Promise<void> {
  await api.patch(`/career/employer/applications/${id}`, input)
}
