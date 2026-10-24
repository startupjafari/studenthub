import type {
  CreateRoomInput,
  RoomListQueryInput,
  UpdateRoomInput,
} from '@studenthub/shared-schemas'
import { api, getPaged, type Paged } from '../../../shared/api'
import type { Room, RoomQr, RoomStatusResponse } from '../model/types'

export const roomKeys = {
  all: ['rooms'] as const,
  // Параметры целиком в ключе: выборка зависит и от scope, и от порядка сортировки.
  list: (params: Partial<RoomListQueryInput> = {}) => ['rooms', 'list', params] as const,
  /** Все помещения вуза разом — для печати наклеек пачкой на корпус или этаж. */
  everything: () => ['rooms', 'list', 'all'] as const,
  status: (code: string) => ['rooms', 'status', code] as const,
}

/**
 * Страница помещений с сортировкой и счётчиком — для таблицы администратора и выбора
 * аудитории (`RoomSelect`, поиск `search` по названию). Массива «всех помещений» нет
 * намеренно: сервер отдаёт не больше 100 за раз, и такой массив молча обрезал бы вуз.
 */
export async function fetchRoomsSorted(
  params: Partial<RoomListQueryInput> = {},
): Promise<Paged<Room>> {
  return getPaged<Room>('/rooms', { page: 1, limit: 100, ...params })
}

/**
 * Все помещения вуза — для печати наклеек пачкой на корпус или этаж (§3.9). Сервер отдаёт по
 * 100, поэтому за первой страницей догружаются остальные: обрезанный список молча оставил
 * бы часть корпуса без наклеек.
 */
export async function fetchAllRooms(): Promise<Room[]> {
  const params = { sort: 'name' as const, order: 'asc' as const, limit: 100 }
  const first = await getPaged<Room>('/rooms', { ...params, page: 1 })
  const pages = Math.ceil(first.total / params.limit)
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
      getPaged<Room>('/rooms', { ...params, page: i + 2 }),
    ),
  )
  const byId = new Map<string, Room>()
  for (const page of [first, ...rest]) for (const room of page.items) byId.set(room.id, room)
  return [...byId.values()]
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
