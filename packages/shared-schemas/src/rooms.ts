import { z } from 'zod'
import { SortOrderSchema, OffsetPaginationSchema } from './pagination.js'

// Аудитории и помещения (docs/PROJECT.md §3.1, §3.9, §6). Принадлежат вузу; учебные
// используются в расписании (Ф6), у всех может быть печатный QR (Ф16).

/**
 * Назначение помещения. Зеркало enum RoomKind в Prisma — единственный источник для
 * валидации DTO на бэкенде и типов на фронте (дублировать список в web запрещено, §15.5).
 */
export const ROOM_KINDS = [
  'AUDITORIUM',
  'LAB',
  'SPORT_HALL',
  'LIBRARY',
  'ASSEMBLY_HALL',
  'ADMIN_OFFICE',
  'DEAN_OFFICE',
  'ACCOUNTING',
  'CANTEEN',
  'DORMITORY',
  'OTHER',
] as const
export const RoomKindSchema = z.enum(ROOM_KINDS)
export type RoomKind = z.infer<typeof RoomKindSchema>

/**
 * Учебные помещения: занятия приходят из расписания (`Pair.roomId`), поэтому по QR
 * показываем текущую/следующую пару. У остальных пар нет — показываем часы работы и контакт.
 * Держим здесь, а не в UI: и API, и фронт должны решать это одинаково.
 */
export const ACADEMIC_ROOM_KINDS: readonly RoomKind[] = ['AUDITORIUM', 'LAB', 'SPORT_HALL']

export function isAcademicRoomKind(kind: RoomKind): boolean {
  return ACADEMIC_ROOM_KINDS.includes(kind)
}

/**
 * Необязательное текстовое поле формы. Пустой input приходит как `''`, а не как `undefined`,
 * и на `.min(1).optional()` это давало отказ валидации — для пользователя молчаливый
 * («Добавить» не срабатывает без объяснения). Поэтому пустую строку и пробелы трактуем
 * как «поле не заполнено».
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    // Через .transform, а не .preprocess: preprocess делает входной тип `unknown`,
    // и zodResolver перестаёт согласовываться с типом значений формы.
    .transform((v) => (v === undefined || v === '' ? undefined : v))

// Поля помещения, общие для создания и обновления.
const roomFields = {
  name: z.string().trim().min(1).max(100),
  capacity: z.number().int().positive().max(10000),
  kind: RoomKindSchema,
  building: optionalText(100),
  floor: z.number().int().min(-5).max(100),
  // Свободный текст: режимы работы у вузов разные («Пн–Пт 09:00–18:00, обед 13:00–14:00»).
  openHours: optionalText(200),
  phone: optionalText(30),
  info: optionalText(500),
}

export const CreateRoomSchema = z
  .object({
    name: roomFields.name,
    capacity: roomFields.capacity.optional(),
    // Необязателен: администратор вуза создаёт помещение в СВОЙ вуз, и вуз берётся из JWT,
    // а не из тела запроса (§6.1, как в specialties). Платформенный админ указывает явно.
    universityId: z.string().min(1).optional(),
    kind: roomFields.kind.optional(),
    building: roomFields.building,
    floor: roomFields.floor.optional(),
    openHours: roomFields.openHours,
    phone: roomFields.phone,
    info: roomFields.info,
  })
  .strict()
export type CreateRoomInput = z.infer<typeof CreateRoomSchema>

export const UpdateRoomSchema = z
  .object({
    name: roomFields.name.optional(),
    capacity: roomFields.capacity.nullable().optional(),
    kind: roomFields.kind.optional(),
    building: roomFields.building.nullable(),
    floor: roomFields.floor.nullable().optional(),
    openHours: roomFields.openHours.nullable(),
    phone: roomFields.phone.nullable(),
    info: roomFields.info.nullable(),
  })
  .strict()
export type UpdateRoomInput = z.infer<typeof UpdateRoomSchema>

// Список помещений: пагинация + опциональные фильтры (вуз — для платформы, kind — для админки).
// Колонки таблицы помещений, по которым разрешена сортировка. `qr` — по наличию
// выданного кода: первыми показываются те, кому наклейку ещё не печатали.
export const ROOM_SORT_FIELDS = ['name', 'kind', 'building', 'floor', 'capacity', 'qr'] as const
export const RoomSortSchema = z.enum(ROOM_SORT_FIELDS)
export type RoomSortValue = z.infer<typeof RoomSortSchema>

// sort/order — по всей выборке, а не по открытой странице.
export const RoomListQuerySchema = OffsetPaginationSchema.extend({
  sort: RoomSortSchema.optional(),
  order: SortOrderSchema.optional(),
  universityId: z.string().min(1).optional(),
  kind: RoomKindSchema.optional(),
})
export type RoomListQueryInput = z.infer<typeof RoomListQuerySchema>

// Ф16: выдать QR-коды пачкой (печать наклеек на этаж/корпус). Идемпотентно — у помещения
// с уже выданным кодом код НЕ меняется, иначе печать обесценила бы висящие наклейки.
export const RoomQrBatchSchema = z
  .object({
    roomIds: z.array(z.string().min(1)).min(1).max(200),
  })
  .strict()
export type RoomQrBatchInput = z.infer<typeof RoomQrBatchSchema>
