import type {
  CreatePairInput,
  CreateScheduleChangeInput,
  CreateScheduleInput,
  ScheduleChangeQueryInput,
  ScheduleQueryInput,
  UpdatePairInput,
  UpdateScheduleInput,
} from '@studenthub/shared-schemas'
import { api, type ResponseWithMeta } from '../../../shared/api'
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
  // Префиксы — для инвалидации сразу всех фильтров/диапазонов (realtime schedule:changed).
  allViews: ['schedule', 'view'] as const,
  allChanges: ['schedule', 'changes'] as const,
  view: (filters: ScheduleQueryInput) => ['schedule', 'view', filters] as const,
  changes: (range: ScheduleChangeQueryInput) => ['schedule', 'changes', range] as const,
  containers: (groupId?: string) => ['schedule', 'containers', groupId ?? 'all'] as const,
  container: (id: string) => ['schedule', 'container', id] as const,
}

// ── Просмотр (6.3) ───────────────────────────────────────────────────────────

// Пары и изменения сервер отдаёт страницами по 500: у факультета пар за неделю больше, и
// раньше ответ молча обрезался — у декана пропадали пятница и суббота (BUG-018, BUG-342).
// Страницы забираются подряд до конца; потолок страховочный — десять тысяч пар или
// изменений в одной выборке означали бы не «не дочитали», а сломанные данные.
const SCHEDULE_PAGE_LIMIT = 500
const SCHEDULE_PAGE_MAX = 20

export async function fetchSchedule(filters: ScheduleQueryInput = {}): Promise<ScheduleResponse> {
  const pairs: Pair[] = []
  let timezone: string | null = null
  let cursor: string | undefined
  for (let page = 0; page < SCHEDULE_PAGE_MAX; page += 1) {
    const { data } = await api.get<ScheduleResponse>('/schedule', {
      params: { ...filters, ...(cursor ? { cursor } : {}) },
    })
    timezone = data.timezone
    pairs.push(...data.pairs)
    if (!data.nextCursor) break
    cursor = data.nextCursor
  }
  return { timezone, pairs }
}

export async function fetchScheduleChanges(
  query: ScheduleChangeQueryInput,
): Promise<ScheduleChange[]> {
  const out: ScheduleChange[] = []
  let cursor: string | undefined
  for (let page = 0; page < SCHEDULE_PAGE_MAX; page += 1) {
    const res = (await api.get<ScheduleChange[]>('/schedule/changes', {
      params: { ...query, limit: SCHEDULE_PAGE_LIMIT, ...(cursor ? { cursor } : {}) },
    })) as ResponseWithMeta & { data: ScheduleChange[] }
    out.push(...res.data)
    if (!res.meta?.hasNext || !res.meta.cursor) break
    cursor = res.meta.cursor
  }
  return out
}

export async function createScheduleChangeRequest(
  input: CreateScheduleChangeInput,
): Promise<ScheduleChange> {
  const { data } = await api.post<ScheduleChange>('/schedule/changes', input)
  return data
}

// Убрать ошибочное разовое изменение (C-F16): группе и преподавателям — WS и уведомление.
export async function deleteScheduleChangeRequest(id: string): Promise<void> {
  await api.delete(`/schedule/changes/${id}`)
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
