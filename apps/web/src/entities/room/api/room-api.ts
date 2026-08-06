import type { CreateRoomInput, UpdateRoomInput } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'

export interface Room {
  id: string
  name: string
  capacity: number | null
  universityId: string
  createdAt: string
}

export const roomKeys = {
  all: ['rooms'] as const,
  list: (universityId?: string) => ['rooms', 'list', universityId ?? 'all'] as const,
}

export async function fetchRooms(universityId?: string): Promise<Room[]> {
  const { data } = await api.get<Room[]>('/rooms', {
    params: { page: 1, limit: 100, universityId },
  })
  return data
}

export async function createRoomRequest(input: CreateRoomInput): Promise<Room> {
  const { data } = await api.post<Room>('/rooms', input)
  return data
}

export async function updateRoomRequest(id: string, input: UpdateRoomInput): Promise<Room> {
  const { data } = await api.patch<Room>(`/rooms/${id}`, input)
  return data
}

export async function deleteRoomRequest(id: string): Promise<void> {
  await api.delete(`/rooms/${id}`)
}
