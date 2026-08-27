import type {
  CreateRoomInput,
  RoomKind,
  RoomListQueryInput,
  UpdateRoomInput,
} from '@studenthub/shared-schemas'
import { api, getPaged, type Paged } from '../../../shared/api'
import type { Room, RoomQr, RoomStatusResponse } from '../model/types'

export const roomKeys = {
  all: ['rooms'] as const,
  // Параметры целиком в ключе: выборка зависит и от scope, и от порядка сортировки.
  list: (params: Partial<RoomListQueryInput> = {}) => ['rooms', 'list', params] as const,
  status: (code: string) => ['rooms', 'status', code] as const,
}

export async function fetchRooms(universityId?: string, kind?: RoomKind): Promise<Room[]> {
  const { data } = await api.get<Room[]>('/rooms', {
    params: { page: 1, limit: 100, universityId, kind },
  })
  return data
}

/**
 * То же, но с сортировкой и счётчиком — для таблицы администратора. Отдельной функцией,
 * а не заменой `fetchRooms`: тот отдаёт массив селектам в расписании и модалках, и форма
 * ответа им не нужна.
 */
export async function fetchRoomsSorted(
  params: Partial<RoomListQueryInput> = {},
): Promise<Paged<Room>> {
  return getPaged<Room>('/rooms', { page: 1, limit: 100, ...params })
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

// ── Ф16: печатные QR помещений ───────────────────────────────────────────────

/**
 * Выдать QR пачкой перед печатью. Идемпотентно: помещению с уже выданным кодом код НЕ
 * меняется — иначе печать одной наклейки обесценила бы все висящие.
 */
export async function issueRoomQrRequest(roomIds: string[]): Promise<RoomQr[]> {
  const { data } = await api.post<RoomQr[]>('/rooms/qr/batch', { roomIds })
  return data
}

/** Перевыпуск кода: расклеенные распечатки этого помещения перестают работать. */
export async function rotateRoomQrRequest(roomId: string): Promise<RoomQr> {
  const { data } = await api.post<RoomQr>(`/rooms/${roomId}/qr/rotate`, {})
  return data
}

/** Статус помещения по коду из QR (страница /r/[code]). */
export async function fetchRoomStatus(code: string): Promise<RoomStatusResponse> {
  const { data } = await api.get<RoomStatusResponse>(`/rooms/qr/${code}`)
  return data
}
