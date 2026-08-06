import type { ResolveComplaintInput } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { Complaint, ComplaintChatMessage, ComplaintStatusValue } from '../model/types'

export const complaintKeys = {
  all: ['complaints'] as const,
  list: (status?: string) => ['complaints', 'list', status ?? 'all'] as const,
  messages: (id: string) => ['complaints', id, 'messages'] as const,
}

export async function fetchComplaints(status?: ComplaintStatusValue): Promise<Complaint[]> {
  const { data } = await api.get<Complaint[]>('/complaints', {
    params: { page: 1, limit: 50, status },
  })
  return data
}

export async function resolveComplaintRequest(
  id: string,
  input: ResolveComplaintInput,
): Promise<Complaint> {
  const { data } = await api.patch<Complaint>(`/complaints/${id}/resolve`, input)
  return data
}

export async function fetchComplaintMessages(id: string): Promise<ComplaintChatMessage[]> {
  const { data } = await api.get<ComplaintChatMessage[]>(`/complaints/${id}/messages`)
  return data
}
