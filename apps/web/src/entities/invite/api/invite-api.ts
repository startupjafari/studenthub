import type { CreateInviteInput } from '@studenthub/shared-schemas'
import type { Role } from '@studenthub/shared-types'
import { api } from '../../../shared/api'

export type InviteStatus = 'PENDING' | 'USED' | 'EXPIRED' | 'REVOKED'

// Элемент списка инвайтов (сервер НЕ отдаёт token в списке — только при создании).
export interface InviteListItem {
  id: string
  role: Role
  email: string | null
  status: InviteStatus
  universityId: string | null
  facultyId: string | null
  groupId: string | null
  expiresAt: string
  createdAt: string
}

// Ответ создания: содержит одноразовый token для ссылки-приглашения.
export interface CreatedInvite {
  id: string
  token: string
  role: Role
  universityId: string | null
  facultyId: string | null
  groupId: string | null
  expiresAt: string
  status: InviteStatus
}

export const inviteKeys = {
  all: ['invites'] as const,
  list: () => ['invites', 'list'] as const,
}

export async function fetchInvites(): Promise<InviteListItem[]> {
  const { data } = await api.get<InviteListItem[]>('/invites', { params: { page: 1, limit: 100 } })
  return data
}

export async function createInviteRequest(input: CreateInviteInput): Promise<CreatedInvite> {
  const { data } = await api.post<CreatedInvite>('/invites', input)
  return data
}

export async function revokeInviteRequest(id: string): Promise<void> {
  await api.patch(`/invites/${id}/revoke`)
}
