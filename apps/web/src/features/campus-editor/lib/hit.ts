import {
  faceContains,
  pointInPolygon,
  projectOnSegment,
  type Face,
  type FloorPlanDoc,
  type Pt,
} from '@studenthub/campus-core'
import type { Selection } from '../model/store'

/**
 * Попадание курсором и привязки (docs/CAMPUS_BUILDER.md §12.4). Радиус — в пикселях экрана,
 * переводится в мм от масштаба: на мелком масштабе «прилипает» к тем же 10 px, что и на крупном.
 */
export interface Snap {
  point: Pt
  /** Чем привязано: к узлу, к стене, по ортогонали, к сетке или никак. */
  kind: 'node' | 'wall' | 'ortho' | 'grid' | null
  nodeId?: string
  wallId?: string
}

export function wallPoints(doc: FloorPlanDoc, wallId: string): [Pt, Pt] | null {
  const w = doc.walls[wallId]
  const a = w && doc.nodes[w.a]
  const b = w && doc.nodes[w.b]
  return a && b ? [a, b] : null
}

/** Ближайшая стена в радиусе (с учётом её толщины). */
export function hitWall(
  doc: FloorPlanDoc,
  p: Pt,
  radiusMm: number,
): { wallId: string; t: number; point: Pt } | null {
  let best: { wallId: string; t: number; point: Pt; d: number } | null = null
  for (const [id, w] of Object.entries(doc.walls)) {
    const a = doc.nodes[w.a]
    const b = doc.nodes[w.b]
    if (!a || !b) continue
    const pr = projectOnSegment(p, a, b)
    const limit = radiusMm + w.thicknessMm / 2
    if (pr.distance <= limit && (!best || pr.distance < best.d))
      best = { wallId: id, t: pr.t, point: pr.point, d: pr.distance }
  }
  return best && { wallId: best.wallId, t: best.t, point: best.point }
}

export function hitNode(doc: FloorPlanDoc, p: Pt, radiusMm: number): string | null {
  let best: string | null = null
  let bestD = radiusMm
  for (const [id, n] of Object.entries(doc.nodes)) {
    const d = Math.hypot(n.x - p.x, n.y - p.y)
    if (d <= bestD) {
      best = id
      bestD = d
    }
  }
  return best
}

/** Проём под курсором: точка в пределах ширины проёма вдоль стены и толщины поперёк. */
export function hitOpening(doc: FloorPlanDoc, p: Pt, radiusMm: number): string | null {
  for (const [id, o] of Object.entries(doc.openings)) {
    if (!o.wallId) continue
    const pts = wallPoints(doc, o.wallId)
    if (!pts) continue
    const [a, b] = pts
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const pr = projectOnSegment(p, a, b)
    const along = pr.t * len
    const w = doc.walls[o.wallId]!
    if (
      along >= o.offsetMm - radiusMm &&
      along <= o.offsetMm + o.widthMm + radiusMm &&
      pr.distance <= w.thicknessMm / 2 + radiusMm
    ) {
      return id
    }
  }
  return null
}

/** Что под курсором при выделении: узел → проём → стена → лестница → метка → помещение/грань. */
export function hitTest(
  doc: FloorPlanDoc,
  faces: Face[],
  faceSpace: Record<string, string>,
  p: Pt,
  radiusMm: number,
): Selection {
  const node = hitNode(doc, p, radiusMm)
  if (node) return { kind: 'node', id: node }
  const opening = hitOpening(doc, p, radiusMm)
  if (opening) return { kind: 'opening', id: opening }
  const wall = hitWall(doc, p, radiusMm)
  if (wall) return { kind: 'wall', id: wall.wallId }
  for (const [id, v] of Object.entries(doc.verticals)) {
    if (
      pointInPolygon(
        p,
        v.outline.map(([x, y]) => ({ x, y })),
      ) !== 'outside'
    )
      return { kind: 'vertical', id }
  }
  for (const [id, l] of Object.entries(doc.labels)) {
    if (Math.hypot(l.x - p.x, l.y - p.y) <= radiusMm * 2) return { kind: 'label', id }
  }
  // Самая маленькая грань под курсором (комната внутри холла, а не холл).
  const under = faces.filter((f) => faceContains(f, p)).sort((a, b) => a.areaMm2 - b.areaMm2)[0]
  if (under)
    return faceSpace[under.id]
      ? { kind: 'space', id: faceSpace[under.id]! }
      : { kind: 'face', id: under.id }
  return { kind: 'none' }
}

/**
 * Привязка точки рисования по приоритету: существующий узел → точка на стене → ортогональ от
 * предыдущей точки (с Shift — шаг 15°) → сетка. `free` (Alt) — без привязок.
 */
export function snapPoint(
  doc: FloorPlanDoc,
  raw: Pt,
  radiusMm: number,
  gridMm: number,
  from: Pt | null,
  opts: { free?: boolean; angleStep?: boolean } = {},
): Snap {
  const round = (p: Pt): Pt => ({ x: Math.round(p.x), y: Math.round(p.y) })
  if (opts.free) return { point: round(raw), kind: null }
  const node = hitNode(doc, raw, radiusMm)
  if (node) return { point: doc.nodes[node]!, kind: 'node', nodeId: node }
  if (from && opts.angleStep) {
    const dx = raw.x - from.x
    const dy = raw.y - from.y
    const len = Math.hypot(dx, dy)
    const step = Math.PI / 12
    const angle = Math.round(Math.atan2(dy, dx) / step) * step
    const lenSnapped = Math.round(len / gridMm) * gridMm
    return {
      point: round({
        x: from.x + Math.cos(angle) * lenSnapped,
        y: from.y + Math.sin(angle) * lenSnapped,
      }),
      kind: 'ortho',
    }
  }
  const wall = hitWall(doc, raw, radiusMm)
  if (wall && wall.t > 0 && wall.t < 1)
    return { point: round(wall.point), kind: 'wall', wallId: wall.wallId }
  if (from) {
    // Почти горизонтально или вертикально от предыдущей точки — ровно.
    const dx = Math.abs(raw.x - from.x)
    const dy = Math.abs(raw.y - from.y)
    const g = (v: number): number => Math.round(v / gridMm) * gridMm
    if (dy < radiusMm && dx > dy) return { point: { x: g(raw.x), y: from.y }, kind: 'ortho' }
    if (dx < radiusMm && dy > dx) return { point: { x: from.x, y: g(raw.y) }, kind: 'ortho' }
  }
  return {
    point: { x: Math.round(raw.x / gridMm) * gridMm, y: Math.round(raw.y / gridMm) * gridMm },
    kind: 'grid',
  }
}
