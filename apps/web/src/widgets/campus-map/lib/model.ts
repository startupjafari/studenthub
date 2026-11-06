import {
  buildFaces,
  interiorPoint,
  matchSpaces,
  pointInPolygon,
  toCampus,
  type BuildingTransform,
  type FloorPlanDoc,
  type PlanSpace,
  type Pt,
} from '@studenthub/campus-core'

/** Помещение этажа в координатах кампуса — для заливки, подписей и выбора кликом. */
export interface MapSpace {
  id: string
  space: PlanSpace
  /** Контур и дыры грани, мм кампуса. */
  outer: Pt[]
  holes: Pt[][]
  /** Точка подписи внутри помещения, мм кампуса. */
  label: Pt
  /** Габарит — сколько места под подпись. */
  box: { x0: number; y0: number; x1: number; y1: number }
}

export interface MapIcon {
  kind: 'stairs' | 'elevator' | 'entrance'
  at: Pt
}

export interface FloorModel {
  spaces: MapSpace[]
  /** Наружные стены (с одной стороны — улица): отрезки в мм кампуса. */
  outerWalls: [Pt, Pt][]
  /** Перегородки — тоньше и светлее. */
  innerWalls: [Pt, Pt][]
  icons: MapIcon[]
}

/**
 * Геометрия этажа для карты считается один раз на документ и положение корпуса: документ
 * неизменяемый, поэтому ключ — ссылка на него. Смена этажа или выделения не пересчитывает
 * грани.
 */
const cache = new WeakMap<FloorPlanDoc, Map<string, FloorModel>>()

export function floorModel(doc: FloorPlanDoc, transform: BuildingTransform): FloorModel {
  const key = `${transform.x},${transform.y},${transform.rotationDeg}`
  let byKey = cache.get(doc)
  if (!byKey) cache.set(doc, (byKey = new Map()))
  const hit = byKey.get(key)
  if (hit) return hit

  const at = (p: Pt): Pt => toCampus(p, transform)
  const faces = buildFaces(doc).faces
  const { assignments } = matchSpaces(doc, {}, faces)
  const faceById = new Map(faces.map((f) => [f.id, f]))
  const spaces: MapSpace[] = []
  for (const [id, faceId] of Object.entries(assignments)) {
    const face = faceById.get(faceId)
    const space = doc.spaces[id]
    if (!face || !space || space.visibility === 'hidden') continue
    const outer = face.outer.points.map(at)
    const holes = face.holes.filter((h) => h.points.length >= 3).map((h) => h.points.map(at))
    const xs = outer.map((p) => p.x)
    const ys = outer.map((p) => p.y)
    const inner = interiorPoint(
      face.outer.points,
      face.holes.map((h) => h.points),
    )
    spaces.push({
      id,
      space,
      outer,
      holes,
      label: at(inner ?? space.label),
      box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
    })
  }

  // Стена наружная, если её касается только одна грань.
  const faceCount = new Map<string, number>()
  for (const f of faces) for (const w of f.wallIds) faceCount.set(w, (faceCount.get(w) ?? 0) + 1)
  const outerWalls: [Pt, Pt][] = []
  const innerWalls: [Pt, Pt][] = []
  for (const [wid, w] of Object.entries(doc.walls)) {
    if (w.kind === 'virtual') continue
    const a = doc.nodes[w.a]
    const b = doc.nodes[w.b]
    if (!a || !b) continue
    ;((faceCount.get(wid) ?? 0) <= 1 ? outerWalls : innerWalls).push([at(a), at(b)])
  }

  const icons: MapIcon[] = []
  for (const v of Object.values(doc.verticals)) {
    const n = v.outline.length
    const c = v.outline.reduce((s, [x, y]) => ({ x: s.x + x / n, y: s.y + y / n }), { x: 0, y: 0 })
    icons.push({
      kind: v.type === 'elevator' ? 'elevator' : 'stairs',
      at: at({ x: Math.round(c.x), y: Math.round(c.y) }),
    })
  }
  // Вход — дверь в наружной стене.
  for (const o of Object.values(doc.openings)) {
    if (o.type !== 'door' || !o.wallId || (faceCount.get(o.wallId) ?? 0) > 1) continue
    const w = doc.walls[o.wallId]
    const a = w && doc.nodes[w.a]
    const b = w && doc.nodes[w.b]
    if (!a || !b) continue
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const t = (o.offsetMm + o.widthMm / 2) / len
    icons.push({
      kind: 'entrance',
      at: at({ x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) }),
    })
  }

  const model = { spaces, outerWalls, innerWalls, icons }
  byKey.set(key, model)
  return model
}

/** Помещение под точкой (мм кампуса). */
export function spaceAt(model: FloorModel, p: Pt): MapSpace | null {
  for (const s of model.spaces) {
    if (p.x < s.box.x0 || p.x > s.box.x1 || p.y < s.box.y0 || p.y > s.box.y1) continue
    if (pointInPolygon(p, s.outer) === 'outside') continue
    if (s.holes.some((h) => pointInPolygon(p, h) === 'inside')) continue
    return s
  }
  return null
}
