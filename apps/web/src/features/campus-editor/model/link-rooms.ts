import { ACADEMIC_SPACE_KINDS, type FloorPlanDoc, type SpaceKind } from '@studenthub/campus-core'
import type { CreateRoomInput, RoomKind } from '@studenthub/shared-schemas'

/** Назначение на карте → тип помещения вуза для «Создать аудиторию». */
export const ROOM_KIND_BY_SPACE: Partial<Record<SpaceKind, RoomKind>> = {
  auditorium: 'AUDITORIUM',
  lecture_hall: 'AUDITORIUM',
  computer_lab: 'AUDITORIUM',
  lab: 'LAB',
  sport_hall: 'SPORT_HALL',
  library: 'LIBRARY',
  dean_office: 'DEAN_OFFICE',
  office: 'ADMIN_OFFICE',
  canteen: 'CANTEEN',
}

interface RoomLike {
  id: string
  name: string
  building: string | null
  floor: number | null
}

export interface FloorContext {
  buildingName: string
  buildingCode: string | null
  level: number
}

export interface LinkPlan {
  /** Помещение → найденная аудитория вуза. */
  links: Record<string, string>
  /** Учебные помещения без пары у вуза — для них аудитории создаются. */
  create: { spaceId: string; input: CreateRoomInput }[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** «А-101», «а 101», «А101» — один номер: регистр, пробелы и дефисы не различаем. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[\s\-–—_.]/g, '')
}

/**
 * Связать помещения этажа с аудиториями вуза по номерам. Номер помещения ищется среди
 * названий аудиторий как есть, с буквой корпуса и без неё («101», «А101»). Если тот же номер
 * есть в нескольких корпусах, берётся аудитория этого корпуса и этажа — чужую не берём
 * наугад. Учебным помещениям без пары аудитория создаётся: без связи их не опубликовать.
 * Уже связанные помещения и аудитории, занятые на этом этаже, не трогаются.
 */
export function planRoomLinks(doc: FloorPlanDoc, rooms: RoomLike[], ctx: FloorContext): LinkPlan {
  const code = ctx.buildingCode ? norm(ctx.buildingCode) : ''
  const building = norm(ctx.buildingName)
  const taken = new Set(
    Object.values(doc.spaces)
      .map((s) => s.roomId)
      .filter((id): id is string => !!id),
  )
  const byName = new Map<string, RoomLike[]>()
  // План принимает только uuid аудитории: связь с записью другого вида (старые выгрузки)
  // не сохранится, и весь этаж встанет с ошибкой — такие аудитории не берём.
  for (const r of rooms.filter((x) => UUID.test(x.id))) {
    const key = norm(r.name)
    byName.set(key, [...(byName.get(key) ?? []), r])
  }
  const sameBuilding = (r: RoomLike): boolean => {
    const b = r.building ? norm(r.building) : ''
    return !!b && (b === building || (!!code && b === code))
  }

  const links: Record<string, string> = {}
  const create: LinkPlan['create'] = []
  for (const [spaceId, s] of Object.entries(doc.spaces)) {
    if (s.roomId || !s.number) continue
    const n = norm(s.number)
    const bare = code && n.startsWith(code) ? n.slice(code.length) : n
    const keys = [...new Set([n, bare, code + bare])]
    const candidates = keys
      .flatMap((k) => byName.get(k) ?? [])
      .filter((r, i, all) => !taken.has(r.id) && all.indexOf(r) === i)
    const here = candidates.filter((r) => sameBuilding(r) && (r.floor ?? ctx.level) === ctx.level)
    const pick =
      here[0] ??
      candidates.find(sameBuilding) ??
      // Аудитория без корпуса подходит, только если она одна на весь вуз с таким номером.
      (candidates.length === 1 && !candidates[0]!.building ? candidates[0] : undefined)
    if (pick) {
      links[spaceId] = pick.id
      taken.add(pick.id)
      continue
    }
    if (!ACADEMIC_SPACE_KINDS.includes(s.kind)) continue
    create.push({
      spaceId,
      input: {
        name: s.number.slice(0, 100),
        kind: ROOM_KIND_BY_SPACE[s.kind] ?? 'OTHER',
        capacity: s.capacity,
        building: ctx.buildingName.slice(0, 100) || undefined,
        floor: Math.min(100, Math.max(-5, ctx.level)),
      },
    })
  }
  return { links, create }
}
