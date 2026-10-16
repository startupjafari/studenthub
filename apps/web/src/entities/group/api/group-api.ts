import type {
  AssignStarostaInput,
  CreateGroupInput,
  UpdateGroupInput,
} from '@studenthub/shared-schemas'
import type { Role } from '@studenthub/shared-types'
import { api, getPaged } from '../../../shared/api'

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

export const groupKeys = {
  all: ['groups'] as const,
  list: (facultyId?: string) => ['groups', 'list', facultyId ?? 'all'] as const,
  // Все группы смотрящего, без потолка в 100 (`fetchAllGroups`).
  listAll: () => ['groups', 'list-all'] as const,
  members: (id: string) => ['groups', id, 'members'] as const,
}

export async function fetchGroups(facultyId?: string): Promise<Group[]> {
  const { data } = await api.get<Group[]>('/groups', { params: { page: 1, limit: 100, facultyId } })
  return data
}

// Страница GET /groups — предел OffsetPaginationSchema.
const GROUPS_PAGE = 100
// Потолок — 2000 групп: предохранитель от лавины запросов (лимит — 100 запросов в минуту
// на пользователя), если total разойдётся с выдачей.
const GROUPS_MAX_PAGES = 20

/**
 * Все группы, видимые смотрящему (декан — свой факультет, вуз-роли — свой вуз): страницы
 * по 100, после первой — параллельно. Для пикеров с поиском: у GET /groups нет поиска
 * по названию, а первых 100 групп (`fetchGroups`) большому вузу мало.
 */
export async function fetchAllGroups(facultyId?: string): Promise<Group[]> {
  const params = { limit: GROUPS_PAGE, facultyId }
  const first = await getPaged<Group>('/groups', { ...params, page: 1 })
  const pages = Math.min(Math.ceil(first.total / GROUPS_PAGE), GROUPS_MAX_PAGES)
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
      getPaged<Group>('/groups', { ...params, page: i + 2 }).then((p) => p.items),
    ),
  )
  // Сервер сортирует только по названию, без вторичного ключа: одноимённая группа другого
  // факультета на стыке страниц может прийти дважды — дубль убираем.
  const byId = new Map<string, Group>()
  for (const g of [first.items, ...rest].flat()) byId.set(g.id, g)
  return [...byId.values()]
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
