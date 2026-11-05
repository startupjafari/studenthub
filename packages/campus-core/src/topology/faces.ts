import type { FloorPlanDoc } from '../format/schema.js'
import { compareDirections, type Pt } from '../geom/int.js'
import { pointInPolygon, signedArea2 } from '../geom/polygon.js'

/**
 * Грани планарного графа стен — замкнутые области, из которых получаются помещения
 * (docs/CAMPUS_BUILDER.md §11.4). Граф не хранится в виде DCEL: полурёбра строятся заново
 * при каждом вызове, документ остаётся простым словарём узлов и стен.
 */
export interface FaceRing {
  /** Узлы обхода по порядку (без повтора первого). */
  nodeIds: string[]
  /** Стены обхода без повторов, в порядке первого появления. */
  wallIds: string[]
  points: Pt[]
  /** Удвоенная ориентированная площадь: > 0 — внешний контур грани, ≤ 0 — граница компоненты. */
  area2: number
}

export interface Face {
  /** Детерминированный id: наименьшее полуребро контура. Меняется при правке — это не id помещения. */
  id: string
  outer: FaceRing
  /** Острова внутри грани: колонны, шахты, отдельно стоящие стены. */
  holes: FaceRing[]
  /** Все стены грани: контура и островов. */
  wallIds: string[]
  /** Площадь без дыр, мм². */
  areaMm2: number
}

export interface FacesResult {
  faces: Face[]
  /** Внешние границы компонент, не попавшие внутрь ни одной грани. */
  outside: FaceRing[]
}

interface HalfEdge {
  id: string
  from: string
  to: string
  wall: string
}

export function buildFaces(doc: FloorPlanDoc): FacesResult {
  const out = new Map<string, HalfEdge[]>()
  const halfEdges = new Map<string, HalfEdge>()
  const add = (h: HalfEdge): void => {
    halfEdges.set(h.id, h)
    const list = out.get(h.from)
    if (list) list.push(h)
    else out.set(h.from, [h])
  }
  for (const [wid, w] of Object.entries(doc.walls)) {
    if (w.a === w.b || !doc.nodes[w.a] || !doc.nodes[w.b]) continue
    add({ id: `${wid}>`, from: w.a, to: w.b, wall: wid })
    add({ id: `${wid}<`, from: w.b, to: w.a, wall: wid })
  }

  // Полурёбра у каждого узла — против часовой стрелки по углу (точное сравнение).
  const position = new Map<string, number>()
  for (const [nodeId, list] of out) {
    const o = doc.nodes[nodeId]!
    list.sort((h1, h2) => {
      const p1 = doc.nodes[h1.to]!
      const p2 = doc.nodes[h2.to]!
      return compareDirections({ x: p1.x - o.x, y: p1.y - o.y }, { x: p2.x - o.x, y: p2.y - o.y })
    })
    list.forEach((h, i) => position.set(h.id, i))
  }

  const twinId = (h: HalfEdge): string => (h.id.endsWith('>') ? `${h.wall}<` : `${h.wall}>`)
  // Следующее полуребро грани слева: у узла назначения — предыдущее по часовой от обратного.
  const next = (h: HalfEdge): HalfEdge => {
    const list = out.get(h.to)!
    const i = position.get(twinId(h))!
    return list[(i - 1 + list.length) % list.length]!
  }

  const visited = new Set<string>()
  const rings: FaceRing[] = []
  const ringFirstHalfEdge: string[] = []
  const limit = halfEdges.size + 1
  for (const start of halfEdges.values()) {
    if (visited.has(start.id)) continue
    const nodeIds: string[] = []
    const wallIds: string[] = []
    const seenWalls = new Set<string>()
    let minId = start.id
    let h = start
    for (let guard = 0; guard < limit; guard++) {
      visited.add(h.id)
      nodeIds.push(h.from)
      if (!seenWalls.has(h.wall)) {
        seenWalls.add(h.wall)
        wallIds.push(h.wall)
      }
      if (h.id < minId) minId = h.id
      h = next(h)
      if (h.id === start.id) break
    }
    const points = nodeIds.map((id) => doc.nodes[id]!)
    rings.push({ nodeIds, wallIds, points, area2: signedArea2(points) })
    ringFirstHalfEdge.push(minId)
  }

  const faces: Face[] = []
  const boundaries: FaceRing[] = []
  rings.forEach((ring, i) => {
    if (ring.area2 > 0) {
      faces.push({
        id: ringFirstHalfEdge[i]!,
        outer: ring,
        holes: [],
        wallIds: [...ring.wallIds],
        areaMm2: 0,
      })
    } else {
      boundaries.push(ring)
    }
  })

  // Граница компоненты внутри грани другой компоненты — дыра этой грани (самой маленькой из
  // содержащих). Проверяем по одному узлу: компоненты не пересекаются (инвариант планарности).
  const outside: FaceRing[] = []
  for (const ring of boundaries) {
    const probe = ring.points[0]
    let host: Face | null = null
    if (probe) {
      for (const f of faces) {
        if (f.outer.nodeIds.includes(ring.nodeIds[0]!)) continue
        if (pointInPolygon(probe, f.outer.points) !== 'inside') continue
        if (!host || f.outer.area2 < host.outer.area2) host = f
      }
    }
    if (host) {
      host.holes.push(ring)
      for (const w of ring.wallIds) if (!host.wallIds.includes(w)) host.wallIds.push(w)
    } else {
      outside.push(ring)
    }
  }
  for (const f of faces) {
    f.areaMm2 = (f.outer.area2 + f.holes.reduce((s, h) => s + h.area2, 0)) / 2
  }
  return { faces, outside }
}

/** Точка строго внутри грани: внутри контура и вне всех её островов. */
export function faceContains(face: Face, p: Pt): boolean {
  if (pointInPolygon(p, face.outer.points) !== 'inside') return false
  return face.holes.every((h) => h.points.length < 3 || pointInPolygon(p, h.points) === 'outside')
}
