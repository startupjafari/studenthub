import type {
  CreateEventInput,
  EventListQueryInput,
  UpdateEventInput,
} from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { EventItem, EventParticipant } from '../model/types'

export const eventKeys = {
  all: ['events'] as const,
  list: (filter: string, mine?: boolean) => ['events', 'list', filter, mine ?? false] as const,
  detail: (id: string) => ['events', 'detail', id] as const,
  participants: (id: string) => ['events', id, 'participants'] as const,
}

export async function fetchEvents(query: Partial<EventListQueryInput> = {}): Promise<EventItem[]> {
  const { data } = await api.get<EventItem[]>('/events', {
    params: { page: 1, limit: 50, filter: 'upcoming', ...query },
  })
  return data
}

export async function fetchEvent(id: string): Promise<EventItem> {
  const { data } = await api.get<EventItem>(`/events/${id}`)
  return data
}

export async function createEventRequest(input: CreateEventInput): Promise<EventItem> {
  const { data } = await api.post<EventItem>('/events', input)
  return data
}

export async function updateEventRequest(id: string, input: UpdateEventInput): Promise<EventItem> {
  const { data } = await api.patch<EventItem>(`/events/${id}`, input)
  return data
}

export async function deleteEventRequest(id: string): Promise<void> {
  await api.delete(`/events/${id}`)
}

export async function registerEventRequest(id: string): Promise<void> {
  await api.post(`/events/${id}/register`)
}

export async function cancelEventRequest(id: string): Promise<void> {
  await api.delete(`/events/${id}/register`)
}

export async function fetchEventParticipants(id: string): Promise<EventParticipant[]> {
  const { data } = await api.get<EventParticipant[]>(`/events/${id}/participants`)
  return data
}
