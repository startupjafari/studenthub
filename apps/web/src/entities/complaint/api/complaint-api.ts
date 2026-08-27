import type {
  ComplaintListQueryInput,
  CreateComplaintInput,
  ResolveComplaintInput,
} from '@studenthub/shared-schemas'
import { api, getPaged } from '../../../shared/api'
import type { Paged } from '../../../shared/api'
import type { Complaint, ComplaintChatMessage } from '../model/types'

export const complaintKeys = {
  all: ['complaints'] as const,
  list: (params: Partial<ComplaintListQueryInput> = {}) => ['complaints', 'list', params] as const,
  messages: (id: string) => ['complaints', id, 'messages'] as const,
}

// Подать жалобу на пост/комментарий/сообщение/пользователя. Приоритет очереди считает
// сервер по типу цели — фронт его не передаёт и не угадывает.
export async function createComplaintRequest(input: CreateComplaintInput): Promise<void> {
  await api.post('/complaints', input)
}

// Страница очереди: фильтры/сортировка/пагинация — на сервере (по всей выборке).
export async function fetchComplaints(
  params: Partial<ComplaintListQueryInput> = {},
): Promise<Paged<Complaint>> {
  return getPaged<Complaint>('/complaints', { page: 1, limit: 20, ...params })
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
