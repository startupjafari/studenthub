import type { FloorPlanDoc, PlanSpace } from '../format/schema.js'
import type { Pt } from '../geom/int.js'
import { buildFaces } from '../topology/faces.js'
import { toCampus, type BuildingTransform } from '../topology/building.js'

/**
 * Публикация: индекс помещений и выдача этажа зрителю по уровню доступа
 * (docs/CAMPUS_BUILDER.md §10.1, §19.2). Сервер и клиент считают одинаково.
 */
export type ViewerLevel = 'public' | 'staff' | 'editor'

export interface SpaceIndexEntry {
  spaceId: string
  roomId: string | null
  number: string | null
  name: string | null
  kind: PlanSpace['kind']
  visibility: 'public' | 'staff'
  /** Метка помещения в мм кампуса. */
  center: Pt
  areaMm2: number
}

/** Помещения этажа для поиска и ссылок. Скрытые (hidden) не индексируются. */
export function spaceIndex(doc: FloorPlanDoc, transform: BuildingTransform): SpaceIndexEntry[] {
  const faces = buildFaces(doc).faces
  const byWalls = new Map(faces.map((f) => [[...f.wallIds].sort().join('|'), f]))
  const out: SpaceIndexEntry[] = []
  for (const [spaceId, s] of Object.entries(doc.spaces)) {
    if (s.visibility === 'hidden') continue
    const face = byWalls.get([...s.edges].sort().join('|'))
    out.push({
      spaceId,
      roomId: s.roomId ?? null,
      number: s.number ?? null,
      name: s.name ?? null,
      kind: s.kind,
      visibility: s.visibility,
      center: toCampus(s.label, transform),
      areaMm2: Math.round(face?.areaMm2 ?? 0),
    })
  }
  return out
}

/** Видит ли зритель помещение с такой видимостью. */
export function canSeeSpace(visibility: PlanSpace['visibility'], level: ViewerLevel): boolean {
  if (level === 'editor') return true
  if (visibility === 'hidden') return false
  return visibility === 'public' || level === 'staff'
}

/**
 * Этаж для зрителя: помещения, которых ему не положено видеть, исчезают целиком (их грань
 * остаётся серой неподписанной областью — стены не скрываются, иначе план развалится).
 * Служебные и закрытые двери обычным зрителям показываются как стена с проёмом, но их
 * доступ стирается до `closed`: маршрут через них не построится.
 */
export function floorForViewer(doc: FloorPlanDoc, level: ViewerLevel): FloorPlanDoc {
  if (level === 'editor') return doc
  const spaces: FloorPlanDoc['spaces'] = {}
  for (const [id, s] of Object.entries(doc.spaces))
    if (canSeeSpace(s.visibility, level)) spaces[id] = s
  const openings: FloorPlanDoc['openings'] = {}
  for (const [id, o] of Object.entries(doc.openings)) {
    if (o.wallId === null) continue
    openings[id] =
      o.type === 'door' && o.access === 'staff' && level === 'public'
        ? { ...o, access: 'closed' }
        : o
  }
  return { ...doc, spaces, openings }
}
