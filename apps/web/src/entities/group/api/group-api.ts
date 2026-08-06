import type {
  AssignStarostaInput,
  CreateGroupInput,
  UpdateGroupInput,
} from '@studenthub/shared-schemas'
import type { Role } from '@studenthub/shared-types'
import { api } from '../../../shared/api'

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
  members: (id: string) => ['groups', id, 'members'] as const,
}

export async function fetchGroups(facultyId?: string): Promise<Group[]> {
  const { data } = await api.get<Group[]>('/groups', { params: { page: 1, limit: 100, facultyId } })
  return data
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
