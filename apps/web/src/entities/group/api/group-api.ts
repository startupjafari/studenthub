import type {
  AssignStarostaInput,
  CreateGroupInput,
  GroupListQueryInput,
  UpdateGroupInput,
} from '@studenthub/shared-schemas'
import type { Role } from '@studenthub/shared-types'
import { api, getPaged, type Paged } from '../../../shared/api'

export interface Group {
  id: string
  name: string
  year: number | null
  facultyId: string
  universityId: string
  starostaId: string | null
  createdAt: string
}

export interface GroupMember {
  id: string
  firstName: string
  lastName: string
  role: Role
  avatarUrl: string | null
}

export type GroupListParams = Partial<GroupListQueryInput>

export const groupKeys = {
  all: ['groups'] as const,
  list: (facultyId?: string) => ['groups', 'list', facultyId ?? 'all'] as const,
  // Страница или выдача поиска — под ключом `list(facultyId)`: правки групп сбрасывают
  // `list()`, и по префиксу заодно уходят страницы экрана групп и выдачи пикеров.
  page: (params: GroupListParams) => ['groups', 'list', params.facultyId ?? 'all', params] as const,
  members: (id: string) => ['groups', id, 'members'] as const,
}

/**
 * Первые 100 групп одним массивом. Большому вузу этого мало: экран групп листает
 * страницы (`fetchGroupsPaged`), выбор группы ищет на сервере (`GroupSelect`).
 */
export async function fetchGroups(facultyId?: string): Promise<Group[]> {
  const { data } = await api.get<Group[]>('/groups', { params: { page: 1, limit: 100, facultyId } })
  return data
}

/** Страница групп со счётчиком; `search` — подстрока названия без учёта регистра. */
export async function fetchGroupsPaged(params: GroupListParams = {}): Promise<Paged<Group>> {
  return getPaged<Group>('/groups', { page: 1, limit: 20, ...params })
}

export async function fetchGroupMembers(id: string): Promise<GroupMember[]> {
  const { data } = await api.get<GroupMember[]>(`/groups/${id}/members`)
  return data
}

export async function createGroupRequest(input: CreateGroupInput): Promise<Group> {
  const { data } = await api.post<Group>('/groups', input)
  return data
}

export async function updateGroupRequest(id: string, input: UpdateGroupInput): Promise<Group> {
  const { data } = await api.patch<Group>(`/groups/${id}`, input)
  return data
}

export async function assignStarostaRequest(
  id: string,
  input: AssignStarostaInput,
): Promise<Group> {
  const { data } = await api.patch<Group>(`/groups/${id}/starosta`, input)
  return data
}

export async function deleteGroupRequest(id: string): Promise<void> {
  await api.delete(`/groups/${id}`)
}
