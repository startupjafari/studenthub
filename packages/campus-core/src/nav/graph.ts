import type { FloorPlanDoc, PlanSpace } from '../format/schema.js'
import type { SitePlanDoc } from '../format/site.js'
import type { Pt } from '../geom/int.js'
import { pointInPolygon } from '../geom/polygon.js'
import { buildFaces, faceContains, type Face } from '../topology/faces.js'
import { matchSpaces } from '../topology/match-spaces.js'
import { toCampus, type BuildingTransform } from '../topology/building.js'

/**
 * Навигационный граф кампуса (docs/CAMPUS_BUILDER.md §15). Строится из геометрии: внутри
 * каждого пространства (грани) — граф видимости между дверями, площадками лестниц, метками
 * помещений и вогнутыми углами; двери соединяют соседние пространства; лестницы и лифты —
 * этажи; входы и дорожки территории — корпуса.
 *
 * Хранится компактно (плоские числовые массивы): граф целого кампуса уходит зрителю одним
 * JSON, и объекты на каждый узел раздули бы его в разы.
 */
export const NAV_GRAPH_VERSION = 1

export const NAV_NODE_KINDS = [
  'destination',
  'portal',
  'waypoint',
  'landing',
  'entrance',
  'outdoor',
] as const
export type NavNodeKind = (typeof NAV_NODE_KINDS)[number]

export const NAV_EDGE_KINDS = ['walk', 'door', 'stairs', 'elevator', 'ramp', 'outdoor'] as const
export type NavEdgeKind = (typeof NAV_EDGE_KINDS)[number]

export const NAV_ACCESS = ['public', 'staff', 'closed'] as const
export type NavAccess = (typeof NAV_ACCESS)[number]

export interface NavGraph {
  version: typeof NAV_GRAPH_VERSION
  /** Этажи по индексу; узлы ссылаются на индекс, −1 — улица. */
  floors: string[]
  /** Узлы по 5 чисел: x, y (мм кампуса), z (мм высоты), индекс этажа, код типа. */
  nodes: number[]
  /** Рёбра по 4 числа: a, b, вес (мм-эквивалент), флаги (тип | без ступеней << 3 | доступ << 4). */
  edges: number[]
  /** Узел-назначение → id помещения. */
  spaces: Record<string, string>
}

export interface NavFloorInput {
  floorId: string
  buildingId: string
  elevationMm: number
  doc: FloorPlanDoc
  transform: BuildingTransform
}

/** Отступ узлов от стен: путь не скребёт по стене и не цепляет углы. */
const CLEARANCE_MM = 300
/** Штраф за дверь: открыть, пропустить (§15.1). */
const DOOR_PENALTY_MM = 500
/** Порталы через виртуальную стену — каждые 1,5 м. */
const VIRTUAL_STEP_MM = 1500
/** Внутри пространства каждый узел соединяется с этим числом ближайших видимых. */
const NEAREST = 8
/** Улица дороже коридора: перейти двор — не то же, что пройти по зданию. */
const OUTDOOR_FACTOR = 1.2
/**
 * Дверь в стене, общей с соседним корпусом, ведёт не на улицу, а в него: её внешняя точка
 * лежит у двери соседа. Ближе этого — одна и та же дверь в общей стене (переход).
 */
const PASSAGE_MM = 700
/** Входы разных корпусов без дорожек соединяются напрямую, если ближе. */
const OUTDOOR_MAX_MM = 2_000_000

export function edgeFlags(kind: NavEdgeKind, stepFree: boolean, access: NavAccess): number {
  return NAV_EDGE_KINDS.indexOf(kind) | (stepFree ? 8 : 0) | (NAV_ACCESS.indexOf(access) << 4)
}

export function decodeFlags(flags: number): {
  kind: NavEdgeKind
  stepFree: boolean
  access: NavAccess
} {
  return {
    kind: NAV_EDGE_KINDS[flags & 7] ?? 'walk',
    stepFree: (flags & 8) !== 0,
    access: NAV_ACCESS[(flags >> 4) & 3] ?? 'public',
  }
}

class GraphBuilder {
  readonly nodes: number[] = []
  readonly edges: number[] = []
  readonly spaces: Record<string, string> = {}
  readonly floors: string[] = []
  private readonly floorIndex = new Map<string, number>()

  floor(id: string): number {
    let i = this.floorIndex.get(id)
    if (i === undefined) {
      i = this.floors.length
      this.floors.push(id)
      this.floorIndex.set(id, i)
    }
    return i
  }

  node(p: Pt, z: number, floor: number, kind: NavNodeKind): number {
    const i = this.nodes.length / 5
    this.nodes.push(
      Math.round(p.x),
      Math.round(p.y),
      Math.round(z),
      floor,
      NAV_NODE_KINDS.indexOf(kind),
    )
    return i
  }

  edge(
    a: number,
    b: number,
    w: number,
    kind: NavEdgeKind,
    stepFree = true,
    access: NavAccess = 'public',
  ): void {
    if (a === b) return
    this.edges.push(a, b, Math.max(1, Math.round(w)), edgeFlags(kind, stepFree, access))
  }

  point(i: number): Pt & { z: number } {
    return { x: this.nodes[i * 5]!, y: this.nodes[i * 5 + 1]!, z: this.nodes[i * 5 + 2]! }
  }

  build(): NavGraph {
    return {
      version: NAV_GRAPH_VERSION,
      floors: this.floors,
      nodes: this.nodes,
      edges: this.edges,
      spaces: this.spaces,
    }
  }
}

interface FaceNodes {
  face: Face
  /** Узлы грани: индекс в графе и точка в координатах корпуса. */
  items: { id: number; p: Pt; waypoint: boolean }[]
}

/** Точка у середины проёма, сдвинутая по нормали стены на `side`. */
function offsetFromWall(a: Pt, b: Pt, along: number, side: number): Pt {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const ux = (b.x - a.x) / len
  const uy = (b.y - a.y) / len
  return { x: a.x + ux * along - uy * side, y: a.y + uy * along + ux * side }
}

/** Пересекает ли отрезок p–q границу грани (кроме касаний в концах). */
function crossesBoundary(face: Face, p: Pt, q: Pt): boolean {
  for (const ring of [face.outer, ...face.holes]) {
    const pts = ring.points
    for (let i = 0; i < pts.length; i++) {
      if (properIntersect(p, q, pts[i]!, pts[(i + 1) % pts.length]!)) return true
    }
  }
  return false
}

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

function properIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** Вогнутые углы контура грани, сдвинутые внутрь по биссектрисе. */
function reflexWaypoints(face: Face): Pt[] {
  const out: Pt[] = []
  const rings = [face.outer, ...face.holes.filter((h) => h.points.length >= 3)]
  for (const ring of rings) {
    const pts = ring.points
    const n = pts.length
    // И у внешнего контура (против часовой), и у островов (по часовой) грань лежит слева от
    // обхода: вогнутый для грани угол — всегда поворот направо.
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n]!
      const cur = pts[i]!
      const next = pts[(i + 1) % n]!
      if (cross(prev, cur, next) >= 0) continue
      const v1 = norm({ x: prev.x - cur.x, y: prev.y - cur.y })
      const v2 = norm({ x: next.x - cur.x, y: next.y - cur.y })
      const bis = norm({ x: -(v1.x + v2.x), y: -(v1.y + v2.y) })
      if (!bis.x && !bis.y) continue
      const p = { x: cur.x + bis.x * CLEARANCE_MM * 1.5, y: cur.y + bis.y * CLEARANCE_MM * 1.5 }
      if (faceContains(face, p)) out.push(p)
    }
  }
  return out
}

function norm(v: Pt): Pt {
  const l = Math.hypot(v.x, v.y)
  return l ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 }
}

/**
 * Граф всего кампуса. `site` — территория: её дорожки связывают входы корпусов; без дорожек
 * входы соединяются напрямую (с наценкой за улицу). `obstacles` — контуры корпусов в мм
 * кампуса: уличные связи (вход → дорожка, ворота → дорожка, вход ↔ вход) их не пересекают,
 * иначе линия маршрута шла бы сквозь стены.
 */
export function buildNavGraph(
  floors: readonly NavFloorInput[],
  site: SitePlanDoc | null = null,
  obstacles: readonly (readonly Pt[])[] = [],
): NavGraph {
  const g = new GraphBuilder()
  const entrances: { id: number; buildingId: string; z: number }[] = []
  // Все «наружные» точки дверей, на любом этаже: часть из них — переходы в соседний корпус.
  const doorOuts: { id: number; buildingId: string; z: number }[] = []
  // Уровень земли корпуса — самый низкий этаж с отметкой ≥ 0: двери наружу выше — балконы и
  // террасы, а не входы, через них на улицу не выходят.
  const ground = new Map<string, number>()
  for (const f of floors) {
    if (f.elevationMm < 0) continue
    ground.set(f.buildingId, Math.min(ground.get(f.buildingId) ?? Infinity, f.elevationMm))
  }
  const landings = new Map<string, { id: number; z: number; type: string; stepFree: boolean }[]>()

  for (const f of floors) {
    const fi = g.floor(f.floorId)
    const z = f.elevationMm
    const campus = (p: Pt): Pt => toCampus(p, f.transform)
    const faces = buildFaces(f.doc).faces
    const { assignments } = matchSpaces(f.doc, {}, faces)
    const perFace = new Map<string, FaceNodes>(faces.map((face) => [face.id, { face, items: [] }]))
    const faceAt = (p: Pt): FaceNodes | null => {
      // Самая маленькая грань, содержащая точку: комната внутри холла — комната.
      let best: FaceNodes | null = null
      for (const fn of perFace.values()) {
        if (faceContains(fn.face, p) && (!best || fn.face.areaMm2 < best.face.areaMm2)) best = fn
      }
      return best
    }
    const add = (p: Pt, kind: NavNodeKind, fn: FaceNodes | null): number => {
      const id = g.node(campus(p), z, fi, kind)
      fn?.items.push({ id, p, waypoint: kind === 'waypoint' })
      return id
    }

    // Назначения — метки помещений (скрытые не адресуются, но проходимы как грань).
    for (const [spaceId, faceId] of Object.entries(assignments)) {
      const space: PlanSpace | undefined = f.doc.spaces[spaceId]
      const fn = perFace.get(faceId)
      if (!space || !fn) continue
      const id = add(space.label, 'destination', fn)
      g.spaces[id] = spaceId
    }

    // Двери: по порталу с каждой стороны, ребро-проход между ними.
    for (const o of Object.values(f.doc.openings)) {
      if (o.type !== 'door' || !o.wallId) continue
      const w = f.doc.walls[o.wallId]
      const a = w && f.doc.nodes[w.a]
      const b = w && f.doc.nodes[w.b]
      if (!w || !a || !b) continue
      const mid = o.offsetMm + o.widthMm / 2
      const off = w.thicknessMm / 2 + CLEARANCE_MM
      const p1 = offsetFromWall(a, b, mid, off)
      const p2 = offsetFromWall(a, b, mid, -off)
      const f1 = faceAt(p1)
      const f2 = faceAt(p2)
      if (!f1 && !f2) continue
      const n1 = add(p1, f1 ? 'portal' : 'entrance', f1)
      const n2 = add(p2, f2 ? 'portal' : 'entrance', f2)
      if (!f1) doorOuts.push({ id: n1, buildingId: f.buildingId, z })
      if (!f2) doorOuts.push({ id: n2, buildingId: f.buildingId, z })
      if (z === ground.get(f.buildingId)) {
        if (!f1) entrances.push({ id: n1, buildingId: f.buildingId, z })
        if (!f2) entrances.push({ id: n2, buildingId: f.buildingId, z })
      }
      g.edge(n1, n2, off * 2 + DOOR_PENALTY_MM, 'door', true, o.access)
    }

    // Виртуальные стены — открытая граница зон: порталы по всей длине.
    for (const w of Object.values(f.doc.walls)) {
      if (w.kind !== 'virtual') continue
      const a = f.doc.nodes[w.a]
      const b = f.doc.nodes[w.b]
      if (!a || !b) continue
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      const count = Math.max(1, Math.floor(len / VIRTUAL_STEP_MM))
      for (let k = 0; k < count; k++) {
        const along = (len * (k + 0.5)) / count
        const p1 = offsetFromWall(a, b, along, CLEARANCE_MM)
        const p2 = offsetFromWall(a, b, along, -CLEARANCE_MM)
        const f1 = faceAt(p1)
        const f2 = faceAt(p2)
        if (!f1 || !f2) continue
        g.edge(add(p1, 'portal', f1), add(p2, 'portal', f2), CLEARANCE_MM * 2, 'walk')
      }
    }

    // Площадки лестниц и лифтов.
    for (const v of Object.values(f.doc.verticals)) {
      const fn = faceAt(v.landing)
      const id = add(v.landing, 'landing', fn)
      const list = landings.get(v.groupId) ?? []
      list.push({ id, z, type: v.type, stepFree: v.stepFree })
      landings.set(v.groupId, list)
    }

    // Обход углов и граф видимости внутри каждой грани.
    for (const fn of perFace.values()) {
      if (fn.items.length === 0) continue
      for (const p of reflexWaypoints(fn.face)) add(p, 'waypoint', fn)
      connectVisible(g, fn)
    }
  }

  // Вертикали: соседние по высоте площадки одной группы.
  for (const list of landings.values()) {
    list.sort((a, b) => a.z - b.z)
    for (let i = 0; i + 1 < list.length; i++) {
      const lo = list[i]!
      const hi = list[i + 1]!
      if (lo.z === hi.z) continue
      const dz = hi.z - lo.z
      const pa = g.point(lo.id)
      const pb = g.point(hi.id)
      const flat = Math.hypot(pb.x - pa.x, pb.y - pa.y)
      if (lo.type === 'elevator')
        g.edge(lo.id, hi.id, 30_000 + (5_000 * dz) / 3_300, 'elevator', true)
      else if (lo.type === 'ramp') g.edge(lo.id, hi.id, flat + dz * 2, 'ramp', true)
      else g.edge(lo.id, hi.id, flat + dz * 3, 'stairs', lo.stepFree && hi.stepFree)
    }
  }

  const passages = connectPassages(g, doorOuts, floors)
  // На улицу выходят только настоящие входы: не переход и не точка внутри другого корпуса
  // (дверь в общей стене без двери у соседа — тупик, а не выход во двор).
  const street = entrances.filter((e) => {
    if (passages.has(e.id)) return false
    const p = g.point(e.id)
    return !obstacles.some((ring) => pointInPolygon(p, ring) === 'inside')
  })
  connectOutdoors(g, street, site, obstacles)
  return g.build()
}

/**
 * Переходы между примыкающими корпусами: внешняя точка двери одного корпуса стоит у
 * внутренней точки двери соседа на той же высоте — соединяем их проходом. Возвращает
 * внешние точки, ставшие переходами: на улицу через них не выходят.
 */
function connectPassages(
  g: GraphBuilder,
  doorOuts: { id: number; buildingId: string; z: number }[],
  floors: readonly NavFloorInput[],
): Set<number> {
  const buildingOfFloor = new Map(floors.map((f) => [f.floorId, f.buildingId]))
  const portal = NAV_NODE_KINDS.indexOf('portal')
  const entrance = NAV_NODE_KINDS.indexOf('entrance')
  const linked = new Set<number>()
  const count = g.nodes.length / 5
  for (const e of doorOuts) {
    const p = g.point(e.id)
    let best: { j: number; d: number } | null = null
    for (let j = 0; j < count; j++) {
      const kind = g.nodes[j * 5 + 4]
      const fi = g.nodes[j * 5 + 3]!
      if ((kind !== portal && kind !== entrance) || fi < 0) continue
      if (buildingOfFloor.get(g.floors[fi]!) === e.buildingId) continue
      if (Math.abs(g.nodes[j * 5 + 2]! - p.z) > 1) continue
      const d = Math.hypot(g.nodes[j * 5]! - p.x, g.nodes[j * 5 + 1]! - p.y)
      if (d <= PASSAGE_MM && (!best || d < best.d)) best = { j, d }
    }
    if (!best) continue
    g.edge(e.id, best.j, best.d, 'walk')
    linked.add(e.id)
  }
  return linked
}

function connectVisible(g: GraphBuilder, fn: FaceNodes): void {
  const items = fn.items
  for (let i = 0; i < items.length; i++) {
    const a = items[i]!
    // Кандидаты по расстоянию: обычные узлы — с несколькими ближайшими видимыми, угловые —
    // со всеми видимыми: через них идут кратчайшие пути вокруг углов, обрезать их нельзя.
    const order = items
      .slice(i + 1)
      .map((b) => ({ b, d: Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y) }))
      .sort((x, y) => x.d - y.d)
    let linked = 0
    for (const { b, d } of order) {
      const limited = !a.waypoint && !b.waypoint
      if (limited && linked >= NEAREST) continue
      if (crossesBoundary(fn.face, a.p, b.p)) continue
      if (!faceContains(fn.face, { x: (a.p.x + b.p.x) / 2, y: (a.p.y + b.p.y) / 2 })) continue
      g.edge(a.id, b.id, d, 'walk')
      if (limited) linked += 1
    }
  }
}

/** Пересекает ли отрезок p–q контур какого-нибудь корпуса (кроме касаний в концах). */
function crossesObstacle(obstacles: readonly (readonly Pt[])[], p: Pt, q: Pt): boolean {
  for (const ring of obstacles) {
    for (let i = 0; i < ring.length; i++) {
      if (properIntersect(p, q, ring[i]!, ring[(i + 1) % ring.length]!)) return true
    }
  }
  return false
}

/**
 * Ближайшие `count` целей, до которых можно дойти по прямой, не пересекая корпусов. Таких
 * нет — просто ближайшие: лучше путь сквозь угол, чем вход, отрезанный от улицы.
 */
function nearestReachable<T extends { p: Pt }>(
  from: Pt,
  targets: readonly T[],
  count: number,
  obstacles: readonly (readonly Pt[])[],
): { o: T; d: number }[] {
  const sorted = targets
    .map((o) => ({ o, d: Math.hypot(o.p.x - from.x, o.p.y - from.y) }))
    .sort((a, b) => a.d - b.d)
  const clear = sorted.filter(({ o }) => !crossesObstacle(obstacles, from, o.p)).slice(0, count)
  return clear.length > 0 ? clear : sorted.slice(0, count)
}

function connectOutdoors(
  g: GraphBuilder,
  entrances: { id: number; buildingId: string; z: number }[],
  site: SitePlanDoc | null,
  obstacles: readonly (readonly Pt[])[],
): void {
  const paths = site
    ? Object.values(site.features).filter((f) => f.type === 'path' || f.type === 'road')
    : []
  const outdoorNodes: { id: number; p: Pt }[] = []
  for (const f of paths) {
    if (f.type !== 'path' && f.type !== 'road') continue
    let prev: number | null = null
    let prevP: Pt | null = null
    for (const p of f.line) {
      const id = g.node(p, 0, -1, 'outdoor')
      outdoorNodes.push({ id, p })
      if (prev !== null && prevP)
        g.edge(prev, id, Math.hypot(p.x - prevP.x, p.y - prevP.y), 'outdoor')
      prev = id
      prevP = p
    }
  }
  // Пересечения дорожек: вершины ближе 2 м считаются одним перекрёстком.
  for (let i = 0; i < outdoorNodes.length; i++) {
    for (let j = i + 1; j < outdoorNodes.length; j++) {
      const a = outdoorNodes[i]!
      const b = outdoorNodes[j]!
      const d = Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y)
      if (d < 2_000) g.edge(a.id, b.id, d, 'outdoor')
    }
  }
  for (const e of entrances) {
    const p = g.point(e.id)
    if (outdoorNodes.length > 0) {
      // Вход — к двум ближайшим точкам дорожек, до которых не мешает корпус.
      for (const { o, d } of nearestReachable(p, outdoorNodes, 2, obstacles))
        g.edge(e.id, o.id, d * OUTDOOR_FACTOR, 'outdoor')
    }
  }
  // Ворота — адрес «откуда»: посетитель начинает путь у ворот. Ключ `gate:<id>` в `spaces`.
  if (site) {
    for (const [id, f] of Object.entries(site.features)) {
      if (f.type !== 'gate') continue
      const gate = g.node({ x: f.x, y: f.y }, 0, -1, 'outdoor')
      g.spaces[gate] = `gate:${id}`
      const targets =
        outdoorNodes.length > 0
          ? outdoorNodes
          : entrances.map((e) => ({ id: e.id, p: g.point(e.id) }))
      for (const { o, d } of nearestReachable({ x: f.x, y: f.y }, targets, 2, obstacles))
        g.edge(gate, o.id, d * OUTDOOR_FACTOR, 'outdoor')
    }
  }
  // Входы одного корпуса — всегда в обход по улице; разных корпусов — напрямую, только если
  // дорожек нет совсем (иначе путь обязан идти по дорожкам).
  for (let i = 0; i < entrances.length; i++) {
    for (let j = i + 1; j < entrances.length; j++) {
      const same = entrances[i]!.buildingId === entrances[j]!.buildingId
      if (!same && outdoorNodes.length > 0) continue
      const a = g.point(entrances[i]!.id)
      const b = g.point(entrances[j]!.id)
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      // Напрямую сквозь корпус не ходим: такие входы свяжет дорожка или сам корпус изнутри.
      if (d <= OUTDOOR_MAX_MM && !crossesObstacle(obstacles, a, b))
        g.edge(entrances[i]!.id, entrances[j]!.id, d * OUTDOOR_FACTOR, 'outdoor')
    }
  }
}
