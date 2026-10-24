import type {
  ComplaintFromSupportInput,
  ComplaintListQueryInput,
  CreateComplaintInput,
  ResolveComplaintInput,
} from '@studenthub/shared-schemas'
import { api, getPaged } from '../../../shared/api'
import type { Paged } from '../../../shared/api'
import type { Complaint, ComplaintCard, ComplaintChatMessage } from '../model/types'

export const complaintKeys = {
  all: ['complaints'] as const,
  list: (params: Partial<ComplaintListQueryInput> = {}) => ['complaints', 'list', params] as const,
  detail: (id: string) => ['complaints', id, 'detail'] as const,
  messages: (id: string) => ['complaints', id, 'messages'] as const,
}

// Подать жалобу на пост/комментарий/сообщение/пользователя. Приоритет очереди считает
// сервер по типу цели — фронт его не передаёт и не угадывает.
export async function createComplaintRequest(input: CreateComplaintInput): Promise<void> {
  await api.post('/complaints', input)
}

// Жалоба из обращения в поддержку (команда платформы): автором становится автор обращения,
// текстом — его первое сообщение. Повтор, пока прежняя жалоба в очереди, сервер отклоняет (409).
export async function createComplaintFromSupportRequest(
  input: ComplaintFromSupportInput,
): Promise<Complaint> {
  const { data } = await api.post<Complaint>('/complaints/from-support', input)
  return data
}

// Страница очереди: фильтры/сортировка/пагинация — на сервере (по всей выборке).
export async function fetchComplaints(
  params: Partial<ComplaintListQueryInput> = {},
): Promise<Paged<Complaint>> {
  return getPaged<Complaint>('/complaints', { page: 1, limit: 20, ...params })
}

// Одна жалоба для окна разбора: текст цели, число жалоб на неё и кто за неё отвечает.
export async function fetchComplaint(id: string): Promise<ComplaintCard> {
  const { data } = await api.get<ComplaintCard>(`/complaints/${id}`)
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

// Взять в разбор: жалоба закрепляется за модератором, чтобы двое не разбирали её одновременно.
export async function takeComplaintRequest(id: string): Promise<void> {
  await api.patch(`/complaints/${id}/take`)
}

// Вернуть разобранную жалобу в очередь. Побочные действия (удаление, блокировка) не отменяются.
export async function reopenComplaintRequest(id: string): Promise<Complaint> {
  const { data } = await api.patch<Complaint>(`/complaints/${id}/reopen`)
  return data
}
