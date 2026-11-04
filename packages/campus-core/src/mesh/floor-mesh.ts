import earcut from 'earcut'
import type { FloorPlanDoc, PlanOpening, SpaceKind } from '../format/schema.js'
import type { Pt } from '../geom/int.js'
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
}

export interface FloorMeshOptions {
  elevationMm: number
  heightMm: number
  /** Положение корпуса на территории; нет — координаты корпуса как есть. */
  transform?: BuildingTransform
  /** Высота стен ниже потолка — разрез для вида «этаж сверху». */
  cutHeightMm?: number
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
/** Точка сцены в плоскости пола: [x, z]. */
type Pt3 = [number, number]

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
  for (const face of faces) {
    const spaceId = spaceByFace.get(face.id)
    const kind: SpaceKind | 'none' = spaceId ? (doc.spaces[spaceId]?.kind ?? 'none') : 'none'
    let b = floorBuilders.get(kind)
    if (!b) floorBuilders.set(kind, (b = new Builder()))
    b.polygon(
      face.outer.points.map(scene),
      face.holes.filter((h) => h.points.length >= 3).map((h) => h.points.map(scene)),
      floorY,
    )
  }
  const floors: FloorMesh['floors'] = {}
  for (const [k, b] of floorBuilders) if (!b.empty) floors[k] = b.build()

  return { walls: walls.build(), glass: glass.build(), floors }
}

/** Перекрытие по контуру корпуса — плита под этажом. */
export function slabMesh(
  outline: readonly Pt[],
  elevationMm: number,
  thicknessMm: number,
  transform?: BuildingTransform,
): MeshBuffers {
  const tr = transform ?? { x: 0, y: 0, rotationDeg: 0 }
  const pts = outline.map((p) => {
    const c = toCampus(p, tr)
    return [c.x / 1000, -c.y / 1000] as Pt3
  })
  const m = new Builder()
  const yTop = elevationMm / 1000
  const yBot = yTop - thicknessMm / 1000
  m.polygon(pts, [], yTop)
  // Знак площади в (x, z): от него зависит, какая из двух нормалей ребра — наружная.
  let area2 = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    area2 += a[0] * b[1] - b[0] * a[1]
  }
  const s = area2 > 0 ? 1 : -1
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const n: V3 = [(s * (b[1] - a[1])) / len, 0, (-s * (b[0] - a[0])) / len]
    m.quad([a[0], yBot, a[1]], [b[0], yBot, b[1]], [b[0], yTop, b[1]], [a[0], yTop, a[1]], n)
  }
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
