import type {
  CreateVisitorInput,
  PassItem,
  PassListQueryInput,
  SecuritySummary,
  VisitorItem,
  VisitorListQueryInput,
} from '@studenthub/shared-schemas'
import { api, getPaged, type Paged } from '../../../shared/api'

// Журналы поста охраны (docs/PROJECT.md §3.12). Ведёт охрана, читает охрана и админ вуза.

export type PassListParams = Partial<Omit<PassListQueryInput, 'allowed'>> & { allowed?: boolean }
export type VisitorListParams = Partial<VisitorListQueryInput>

export const securityKeys = {
  all: ['security'] as const,
  summary: () => ['security', 'summary'] as const,
  passes: (params: PassListParams = {}) => ['security', 'passes', params] as const,
  visitors: (params: VisitorListParams = {}) => ['security', 'visitors', params] as const,
}

export async function fetchSecuritySummary(): Promise<SecuritySummary> {
  const { data } = await api.get<SecuritySummary>('/security/summary')
  return data
}

export async function fetchPasses(params: PassListParams = {}): Promise<Paged<PassItem>> {
  const { allowed, ...rest } = params
  return getPaged<PassItem>('/security/passes', {
    page: 1,
    limit: 20,
    ...rest,
    ...(allowed === undefined ? {} : { allowed: String(allowed) }),
  })
}

export async function fetchVisitors(params: VisitorListParams = {}): Promise<Paged<VisitorItem>> {
  return getPaged<VisitorItem>('/security/visitors', { page: 1, limit: 20, ...params })
}

export async function createVisitorRequest(input: CreateVisitorInput): Promise<VisitorItem> {
  const { data } = await api.post<VisitorItem>('/security/visitors', input)
  return data
}

export async function exitVisitorRequest(id: string): Promise<VisitorItem> {
  const { data } = await api.post<VisitorItem>(`/security/visitors/${id}/exit`)
  return data
}
