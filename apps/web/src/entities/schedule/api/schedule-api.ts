import type {
  CreatePairInput,
  CreateScheduleChangeInput,
  CreateScheduleInput,
  ScheduleChangeQueryInput,
  ScheduleQueryInput,
  UpdatePairInput,
  UpdateScheduleInput,
} from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type {
  Pair,
  ScheduleChange,
  ScheduleContainer,
  ScheduleContainerDetail,
  ScheduleResponse,
} from '../model/types'

// Фабрика ключей React Query (docs/FRONTEND_RULES.md §5.5).
export const scheduleKeys = {
  all: ['schedule'] as const,
  view: (filters: ScheduleQueryInput) => ['schedule', 'view', filters] as const,
  changes: (range: ScheduleChangeQueryInput) => ['schedule', 'changes', range] as const,
  containers: (groupId?: string) => ['schedule', 'containers', groupId ?? 'all'] as const,
  container: (id: string) => ['schedule', 'container', id] as const,
}

// ── Просмотр (6.3) ───────────────────────────────────────────────────────────

export async function fetchSchedule(filters: ScheduleQueryInput = {}): Promise<ScheduleResponse> {
  const { data } = await api.get<ScheduleResponse>('/schedule', { params: filters })
  return data
}

export async function fetchScheduleChanges(
  query: ScheduleChangeQueryInput,
): Promise<ScheduleChange[]> {
  const { data } = await api.get<ScheduleChange[]>('/schedule/changes', { params: query })
  return data
}

export async function createScheduleChangeRequest(
  input: CreateScheduleChangeInput,
): Promise<ScheduleChange> {
  const { data } = await api.post<ScheduleChange>('/schedule/changes', input)
  return data
}

// ── Контейнеры (6.4) ───────────────────────────────────────────────────────

export async function fetchScheduleContainers(groupId?: string): Promise<ScheduleContainer[]> {
  const { data } = await api.get<ScheduleContainer[]>('/schedules', { params: { groupId } })
  return data
}

export async function fetchScheduleContainer(id: string): Promise<ScheduleContainerDetail> {
  const { data } = await api.get<ScheduleContainerDetail>(`/schedules/${id}`)
  return data
}

export async function createScheduleRequest(
  input: CreateScheduleInput,
): Promise<ScheduleContainer> {
  const { data } = await api.post<ScheduleContainer>('/schedules', input)
  return data
}

export async function updateScheduleRequest(
  id: string,
  input: UpdateScheduleInput,
): Promise<ScheduleContainer> {
  const { data } = await api.patch<ScheduleContainer>(`/schedules/${id}`, input)
  return data
}

export async function deleteScheduleRequest(id: string): Promise<void> {
  await api.delete(`/schedules/${id}`)
}

// ── Пары (6.4) ─────────────────────────────────────────────────────────────

export async function createPairRequest(input: CreatePairInput): Promise<Pair> {
  const { data } = await api.post<Pair>('/pairs', input)
  return data
}

export async function updatePairRequest(id: string, input: UpdatePairInput): Promise<Pair> {
  const { data } = await api.patch<Pair>(`/pairs/${id}`, input)
  return data
}

export async function deletePairRequest(id: string): Promise<void> {
  await api.delete(`/pairs/${id}`)
}
