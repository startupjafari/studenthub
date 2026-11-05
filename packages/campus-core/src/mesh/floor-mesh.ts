import earcut from 'earcut'
import type { FloorPlanDoc, PlanOpening, SpaceKind } from '../format/schema.js'
import type { Pt } from '../geom/int.js'
import { pointInPolygon } from '../geom/polygon.js'
import { buildFaces } from '../topology/faces.js'
import { matchSpaces } from '../topology/match-spaces.js'
import { toCampus, type BuildingTransform } from '../topology/building.js'

/**
 * Геометрия этажа для 3D (docs/CAMPUS_BUILDER.md §13.2) — без three: плоские массивы
 * координат, которые сцена заворачивает в BufferGeometry. Так сборку можно гонять в тестах
 * и в воркере, а three остаётся только в ленивом чанке просмотра.
 *
 * Система координат сцены — метры, ось Y вверх: план (x, y) → сцена (x, −y), как в
 * three: правая тройка, север плана смотрит в −Z.
 *
 * Стены — призмы по оси с вырезами под проёмы: дверь — перемычка над ней, окно —
 * подоконная часть и перемычка. Стыки закрываются столбом в узле размером с толщину
 * самой толстой стены: на прямых углах это ровно митра, на острых — без щелей, что
 * для обзорной карты важнее точной геометрии фаски.
 */
export interface MeshBuffers {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}

export interface FloorMesh {
  /** Глухие стены этажа одной геометрией (один draw call). */
  walls: MeshBuffers
  /** Стеклянные перегородки и остекление окон — отдельный прозрачный материал. */
  glass: MeshBuffers
  /** Пол помещений по типам: цвет типа — материал, геометрия — одна на тип. */
  floors: Partial<Record<SpaceKind | 'none', MeshBuffers>>
  /** Лестницы и пандусы — марши ступенями от площадки вверх. */
  stairs: MeshBuffers
  /** Лифты — шахты на высоту этажа. */
  elevators: MeshBuffers
}

export interface FloorMeshOptions {
  elevationMm: number
  heightMm: number
  /** Положение корпуса на территории; нет — координаты корпуса как есть. */
  transform?: BuildingTransform
  /** Высота стен ниже потолка — разрез для вида «этаж сверху». */
  cutHeightMm?: number
  /**
   * Проёмы в полу — контуры в мм корпуса: лестничные клетки и шахты, что поднимаются с этажа
   * ниже. Там пола нет, иначе путь по лестнице или в лифте шёл бы сквозь него.
   */
  openings?: readonly (readonly Pt[])[]
}

/** Все точки `inner` строго внутри `outer` (касание контура — уже не дыра для earcut). */
function insidePoly(inner: readonly Pt[], outer: readonly Pt[]): boolean {
  return inner.every((p) => pointInPolygon(p, outer) === 'inside')
}

/** Все точки `inner` внутри `outer` или на его контуре: грань целиком в проёме. */
function coveredBy(inner: readonly Pt[], outer: readonly Pt[]): boolean {
  return inner.every((p) => pointInPolygon(p, outer) !== 'outside')
}

class Builder {
  private pos: number[] = []
  private nor: number[] = []
  private idx: number[] = []

  /** Четырёхугольник a-b-c-d; обход разворачивается сам, чтобы лицо смотрело по нормали. */
  quad(a: V3, b: V3, c: V3, d: V3, n: V3): void {
    const base = this.pos.length / 3
    for (const p of [a, b, c, d]) {
      this.pos.push(p[0], p[1], p[2])
      this.nor.push(n[0], n[1], n[2])
    }
    const facing = dot(cross(sub(b, a), sub(c, a)), n) > 0
    if (facing) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
    else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2)
  }

  /** Плоский многоугольник (с дырами) на высоте y, нормаль вверх. */
  polygon(outer: Pt3[], holes: Pt3[][], y: number): void {
    const flat: number[] = []
    const holeStarts: number[] = []
    for (const p of outer) flat.push(p[0], p[1])
    for (const h of holes) {
      holeStarts.push(flat.length / 2)
      for (const p of h) flat.push(p[0], p[1])
    }
    const tris = earcut(flat, holeStarts.length ? holeStarts : undefined)
    const base = this.pos.length / 3
    for (let i = 0; i < flat.length; i += 2) {
      this.pos.push(flat[i]!, y, flat[i + 1]!)
      this.nor.push(0, 1, 0)
    }
    // Обход earcut зависит от ориентации контура, а план → сцена ещё и отражает ось: каждый
    // треугольник разворачиваем так, чтобы лицевая сторона смотрела вверх (+Y).
    for (let i = 0; i < tris.length; i += 3) {
      const [a, b, c] = [tris[i]!, tris[i + 1]!, tris[i + 2]!]
      const ux = flat[b * 2]! - flat[a * 2]!
      const uz = flat[b * 2 + 1]! - flat[a * 2 + 1]!
      const vx = flat[c * 2]! - flat[a * 2]!
      const vz = flat[c * 2 + 1]! - flat[a * 2 + 1]!
      const up = uz * vx - ux * vz > 0
      this.idx.push(base + a, base + (up ? b : c), base + (up ? c : b))
    }
  }

  get empty(): boolean {
    return this.idx.length === 0
  }

  build(): MeshBuffers {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nor),
      indices: new Uint32Array(this.idx),
    }
  }
}

type V3 = [number, number, number]

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
/** Точка сцены в плоскости пола: [x, z], метры. */
export type Pt3 = [number, number]

/**
 * Прямоугольная призма вдоль оси a→b (в плоскости пола), полутолщина t, по высоте y0..y1.
 * `caps` — закрывать ли торцы (у кусков стены между проёмами торцы — откосы проёма).
 */
function prism(m: Builder, a: Pt3, b: Pt3, t: number, y0: number, y1: number, caps = true): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (len < 1e-6 || y1 - y0 < 1e-6) return
  const ux = (b[0] - a[0]) / len
  const uz = (b[1] - a[1]) / len
  const nx = -uz * t
  const nz = ux * t
  const A1: V3 = [a[0] + nx, y0, a[1] + nz]
  const A2: V3 = [a[0] - nx, y0, a[1] - nz]
  const B1: V3 = [b[0] + nx, y0, b[1] + nz]
  const B2: V3 = [b[0] - nx, y0, b[1] - nz]
  const up = (p: V3): V3 => [p[0], y1, p[2]]
  const side: V3 = [-uz, 0, ux]
  m.quad(A1, up(A1), up(B1), B1, side)
  m.quad(B2, up(B2), up(A2), A2, [uz, 0, -ux])
  m.quad(up(A1), up(A2), up(B2), up(B1), [0, 1, 0])
  m.quad(A1, B1, B2, A2, [0, -1, 0])
  if (caps) {
    m.quad(A2, up(A2), up(A1), A1, [-ux, 0, -uz])
    m.quad(B1, up(B1), up(B2), B2, [ux, 0, uz])
  }
}

export function floorMesh(doc: FloorPlanDoc, options: FloorMeshOptions): FloorMesh {
  const tr = options.transform ?? { x: 0, y: 0, rotationDeg: 0 }
  const scene = (p: Pt): Pt3 => {
    const c = toCampus(p, tr)
    return [c.x / 1000, -c.y / 1000]
  }
  const y0 = options.elevationMm / 1000
  const top = (options.cutHeightMm ?? options.heightMm) / 1000
  const walls = new Builder()
  const glass = new Builder()

  const openingsByWall = new Map<string, PlanOpening[]>()
  for (const o of Object.values(doc.openings)) {
    if (!o.wallId) continue
    const list = openingsByWall.get(o.wallId)
    if (list) list.push(o)
    else openingsByWall.set(o.wallId, [o])
  }

  const nodeThickness = new Map<string, { t: number; dir: Pt3; degree: number }>()
  for (const [wid, w] of Object.entries(doc.walls)) {
    if (w.kind === 'virtual') continue
    const na = doc.nodes[w.a]
    const nb = doc.nodes[w.b]
    if (!na || !nb) continue
    const a = scene(na)
    const b = scene(nb)
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 1e-6) continue
    const t = w.thicknessMm / 2000
    const height = Math.min(top, (w.heightMm ?? options.heightMm) / 1000)
    const target = w.kind === 'glass' ? glass : walls
    const dir: Pt3 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
    for (const n of [w.a, w.b]) {
      const cur = nodeThickness.get(n)
      if (!cur) nodeThickness.set(n, { t, dir, degree: 1 })
      else
        nodeThickness.set(n, {
          t: Math.max(cur.t, t),
          dir: t > cur.t ? dir : cur.dir,
          degree: cur.degree + 1,
        })
    }

    // Отрезки стены между проёмами, по длине в метрах от узла a.
    const at = (m: number): Pt3 => [a[0] + dir[0] * m, a[1] + dir[1] * m]
    const ops = (openingsByWall.get(wid) ?? [])
      .map((o) => ({ o, s: o.offsetMm / 1000, e: (o.offsetMm + o.widthMm) / 1000 }))
      .filter((x) => x.e > 0 && x.s < len)
      .sort((p, q) => p.s - q.s)
    let cursor = 0
    for (const { o, s, e } of ops) {
      const s1 = Math.max(cursor, s)
      const e1 = Math.min(len, e)
      if (s1 > cursor) prism(target, at(cursor), at(s1), t, y0, y0 + height)
      if (e1 <= s1) continue
      const head = Math.min(height, o.heightMm / 1000 + (o.type === 'window' ? o.sillMm / 1000 : 0))
      // Перемычка над проёмом.
      if (head < height) prism(target, at(s1), at(e1), t, y0 + head, y0 + height, false)
      if (o.type === 'window') {
        const sill = Math.min(height, o.sillMm / 1000)
        if (sill > 0) prism(target, at(s1), at(e1), t, y0, y0 + sill, false)
        // Стекло — тонкая пластина по оси стены.
        if (head > sill) prism(glass, at(s1), at(e1), 0.01, y0 + sill, y0 + head, false)
      }
      cursor = Math.max(cursor, e1)
    }
    if (cursor < len) prism(target, at(cursor), at(len), t, y0, y0 + height)
  }

  // Столбы в стыках: закрывают щели между торцами стен под углом.
  for (const [nid, { t, dir, degree }] of nodeThickness) {
    if (degree < 2) continue
    const n = doc.nodes[nid]
    if (!n) continue
    const c = scene(n)
    prism(
      walls,
      [c[0] - dir[0] * t, c[1] - dir[1] * t],
      [c[0] + dir[0] * t, c[1] + dir[1] * t],
      t,
      y0,
      y0 + top,
    )
  }

  // Полы помещений — по граням графа стен, цвет по типу помещения.
  const faces = buildFaces(doc).faces
  const { assignments } = matchSpaces(doc, {}, faces)
  const spaceByFace = new Map(Object.entries(assignments).map(([s, f]) => [f, s]))
  const floorBuilders = new Map<SpaceKind | 'none', Builder>()
  const floorY = y0 + 0.02
  const openings = options.openings ?? []
  for (const face of faces) {
    // Грань целиком в проёме (лестничная клетка обнесена стенами) — пола нет вовсе;
    // проём внутри грани — дыра в её полу.
    if (openings.some((o) => coveredBy(face.outer.points, o))) continue
    const holes = face.holes.filter((h) => h.points.length >= 3).map((h) => h.points)
    const cut = openings.filter(
      (o) => insidePoly(o, face.outer.points) && !holes.some((h) => coveredBy(o, h)),
    )
    const spaceId = spaceByFace.get(face.id)
    const kind: SpaceKind | 'none' = spaceId ? (doc.spaces[spaceId]?.kind ?? 'none') : 'none'
    let b = floorBuilders.get(kind)
    if (!b) floorBuilders.set(kind, (b = new Builder()))
    b.polygon(
      face.outer.points.map(scene),
      [...holes, ...cut].map((h) => h.map(scene)),
      floorY,
    )
  }
  const floors: FloorMesh['floors'] = {}
  for (const [k, b] of floorBuilders) if (!b.empty) floors[k] = b.build()

  // Лестницы, пандусы и лифты. Фигура — повёрнутый прямоугольник по её длинной стороне:
  // так любая нарисованная форма читается маршем или шахтой.
  const stairs = new Builder()
  const elevators = new Builder()
  for (const v of Object.values(doc.verticals)) {
    const pts = v.outline.map(([x, y]) => scene({ x, y }))
    const box = orientedBox(pts)
    if (!box) continue
    const { u, w, s0, s1, t0, t1 } = box
    const at = (s: number, t: number): Pt3 => [u[0] * s + w[0] * t, u[1] * s + w[1] * t]
    const half = (t1 - t0) / 2
    const mid = (t0 + t1) / 2
    if (v.type === 'elevator') {
      prism(elevators, at(s0, mid), at(s1, mid), half, y0, y0 + top)
      continue
    }
    // Двухмаршевая лестница: первый марш — от края у площадки к дальнему краю по одной
    // половине ширины, там промежуточная площадка во всю ширину, второй марш — обратно по
    // другой половине. Наверх приходят к тому же краю, где площадка следующего этажа.
    const geo = stairGeometry(box, scene(v.landing), Math.min(top, options.heightMm / 1000))
    for (const f of geo.flights) {
      for (let i = 0; i < f.steps; i++) {
        const k0 = i / f.steps
        const k1 = (i + 1) / f.steps
        const a = f.s0 + (f.s1 - f.s0) * k0
        const b = f.s0 + (f.s1 - f.s0) * k1
        prism(stairs, at(a, f.t), at(b, f.t), f.half, y0, y0 + f.y0 + (f.y1 - f.y0) * k1)
      }
    }
    const pl = geo.platform
    prism(stairs, at(pl.s0, mid), at(pl.s1, mid), half, y0, y0 + pl.y)
  }

  return {
    walls: walls.build(),
    glass: glass.build(),
    floors,
    stairs: stairs.build(),
    elevators: elevators.build(),
  }
}

/** Шаг ступени по высоте, м. */
const STEP_RISE_M = 0.17

export interface StairFlight {
  /** Вдоль длинной оси: откуда и куда идёт марш (по `u`), ось марша и полуширина (по `w`). */
  s0: number
  s1: number
  t: number
  half: number
  /** Высота над полом этажа в начале и в конце марша, м. */
  y0: number
  y1: number
  steps: number
}

/**
 * Геометрия двухмаршевой лестницы в повёрнутом прямоугольнике фигуры (метры сцены, оси
 * `u`/`w` из orientedBox): два марша и промежуточная площадка на половине высоты. Общая для
 * 3D и пути по лестнице — путь идёт ровно по ступеням, а не сквозь них.
 */
export function stairGeometry(
  box: { u: Pt3; w: Pt3; s0: number; s1: number; t0: number; t1: number },
  landing: Pt3,
  rise: number,
): { flights: [StairFlight, StairFlight]; platform: { s0: number; s1: number; y: number } } {
  const { u, s0, s1, t0, t1 } = box
  const ls = landing[0] * u[0] + landing[1] * u[1]
  const fromStart = Math.abs(ls - s0) <= Math.abs(ls - s1)
  const near = fromStart ? s0 : s1
  const far = fromStart ? s1 : s0
  const dir = fromStart ? 1 : -1
  const platformLen = Math.min(1.4, (s1 - s0) * 0.3)
  const edge = far - dir * platformLen
  const quarter = (t1 - t0) / 4
  const steps = Math.max(3, Math.round(rise / 2 / STEP_RISE_M))
  return {
    flights: [
      { s0: near, s1: edge, t: t0 + quarter, half: quarter, y0: 0, y1: rise / 2, steps },
      { s0: edge, s1: near, t: t1 - quarter, half: quarter, y0: rise / 2, y1: rise, steps },
    ],
    platform: { s0: Math.min(edge, far), s1: Math.max(edge, far), y: rise / 2 },
  }
}

/**
 * Прямоугольник вокруг фигуры, повёрнутый по её самой длинной стороне: оси `u` (вдоль) и
 * `w` (поперёк) и границы проекций точек на них.
 */
export function orientedBox(
  pts: Pt3[],
): { u: Pt3; w: Pt3; s0: number; s1: number; t0: number; t1: number } | null {
  let best = { len: 0, u: [1, 0] as Pt3 }
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len > best.len) best = { len, u: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] }
  })
  if (best.len < 1e-6) return null
  const u = best.u
  const w: Pt3 = [-u[1], u[0]]
  const s = pts.map((p) => p[0] * u[0] + p[1] * u[1])
  const t = pts.map((p) => p[0] * w[0] + p[1] * w[1])
  const box = {
    u,
    w,
    s0: Math.min(...s),
    s1: Math.max(...s),
    t0: Math.min(...t),
    t1: Math.max(...t),
  }
  return box.s1 - box.s0 < 1e-6 || box.t1 - box.t0 < 1e-6 ? null : box
}

/**
 * Перекрытие по контуру корпуса — плита под этажом. `holes` — проёмы в мм корпуса
 * (лестничные клетки, шахты): в плите дыра, по её краю — торец плиты.
 */
export function slabMesh(
  outline: readonly Pt[],
  elevationMm: number,
  thicknessMm: number,
  transform?: BuildingTransform,
  holes: readonly (readonly Pt[])[] = [],
): MeshBuffers {
  const tr = transform ?? { x: 0, y: 0, rotationDeg: 0 }
  const pts = outline.map((p) => {
    const c = toCampus(p, tr)
    return [c.x / 1000, -c.y / 1000] as Pt3
  })
  const m = new Builder()
  const yTop = elevationMm / 1000
  const yBot = yTop - thicknessMm / 1000
  const inner = holes
    .filter((h) => h.length >= 3 && insidePoly(h, outline))
    .map((h) =>
      h.map((p) => {
        const c = toCampus(p, tr)
        return [c.x / 1000, -c.y / 1000] as Pt3
      }),
    )
  m.polygon(pts, inner, yTop)
  // Торцы: у внешнего контура нормаль наружу, у проёма — внутрь проёма (тоже «из плиты»).
  const edges = (ring: Pt3[], outward: boolean): void => {
    // Знак площади в (x, z): от него зависит, какая из двух нормалей ребра — наружная.
    let area2 = 0
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!
      const b = ring[(i + 1) % ring.length]!
      area2 += a[0] * b[1] - b[0] * a[1]
    }
    const s = (area2 > 0 ? 1 : -1) * (outward ? 1 : -1)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!
      const b = ring[(i + 1) % ring.length]!
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      const n: V3 = [(s * (b[1] - a[1])) / len, 0, (-s * (b[0] - a[0])) / len]
      m.quad([a[0], yBot, a[1]], [b[0], yBot, b[1]], [b[0], yTop, b[1]], [a[0], yTop, a[1]], n)
    }
  }
  edges(pts, true)
  for (const h of inner) edges(h, false)
  return m.build()
}

/** Пол одного помещения чуть выше остальных — подсветка выбранного или найденного. */
export function spaceHighlightMesh(
  doc: FloorPlanDoc,
  spaceId: string,
  options: FloorMeshOptions,
): MeshBuffers | null {
  const tr = options.transform ?? { x: 0, y: 0, rotationDeg: 0 }
  const scene = (p: Pt): Pt3 => {
    const c = toCampus(p, tr)
    return [c.x / 1000, -c.y / 1000]
  }
  const faces = buildFaces(doc).faces
  const faceId = matchSpaces(doc, {}, faces).assignments[spaceId]
  const face = faces.find((f) => f.id === faceId)
  if (!face) return null
  const m = new Builder()
  m.polygon(
    face.outer.points.map(scene),
    face.holes.filter((h) => h.points.length >= 3).map((h) => h.points.map(scene)),
    options.elevationMm / 1000 + 0.04,
  )
  return m.build()
}
