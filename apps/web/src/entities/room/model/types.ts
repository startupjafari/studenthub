import type { RoomKind } from '@studenthub/shared-schemas'
import type { Pair, ScheduleChange } from '../../schedule'

// Типы помещений — зеркало ответов API (docs/PROJECT.md §3.9, Ф16).
// RoomKind не дублируем: единственный источник — @studenthub/shared-schemas (§15.5).

export type { RoomKind }

export interface Room {
  id: string
  name: string
  capacity: number | null
  universityId: string
  kind: RoomKind
  building: string | null
  floor: number | null
  openHours: string | null
  phone: string | null
  info: string | null
  // Выдан ли печатный QR: сам код и картинку отдают эндпоинты qr/*.
  qrCode: string | null
  qrIssuedAt: string | null
  createdAt: string
}

/** Пара в помещении: как в расписании, но с именем группы — главный вопрос сканирующего. */
export interface RoomPair extends Pair {
  group: { id: string; name: string } | null
}

/** Ответ эндпоинтов выдачи QR — всё, что нужно печатной наклейке. */
export interface RoomQr {
  roomId: string
  name: string
  kind: RoomKind
  building: string | null
  floor: number | null
  capacity: number | null
  // Печатается на наклейке у неучебных помещений (библиотека, бухгалтерия).
  openHours: string | null
  university: string
  universityShort: string | null
  code: string
  url: string
  issuedAt: string | null
  // data:image/png — готовое изображение с сервера.
  qr: string
}

/** GET /rooms/qr/:code — то, что видит студент после сканирования. */
export interface RoomStatusResponse {
  room: {
    id: string
    name: string
    kind: RoomKind
    building: string | null
    floor: number | null
    capacity: number | null
    openHours: string | null
    phone: string | null
    info: string | null
    university: string
    universityShort: string | null
  }
  // Учебное помещение (есть расписание пар) или нет.
  academic: boolean
  timezone: string | null
  // «Сейчас» по часам сервера в таймзоне вуза: часы на телефоне студента могут врать.
  now: { date: string; time: string; dayOfWeek: number }
  pairs: RoomPair[]
  changes: ScheduleChange[]
}
