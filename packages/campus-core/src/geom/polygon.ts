import { orient, onSegment, type Pt } from './int.js'

/**
 * Удвоенная ориентированная площадь (формула шнурков). > 0 — обход против часовой.
 * Считается от первой вершины: так слагаемые меньше и ошибка округления double ничтожна для
 * контуров размером с кампус. Знак у невырожденных контуров надёжен; точность самой площади
 * — до долей мм², чего с запасом хватает.
 */
export function signedArea2(poly: readonly Pt[]): number {
  const n = poly.length
  if (n < 3) return 0
  const o = poly[0]!
  let sum = 0
  for (let i = 1; i < n - 1; i++) {
    const p = poly[i]!
    const q = poly[i + 1]!
    sum += (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x)
  }
  return sum
}

export type PointInPolygon = 'inside' | 'outside' | 'boundary'

/**
 * Положение точки относительно многоугольника — по числу оборотов (winding number) на
 * точных предикатах. Работает для любого направления обхода.
 */
export function pointInPolygon(p: Pt, poly: readonly Pt[]): PointInPolygon {
  const n = poly.length
  let winding = 0
  for (let i = 0; i < n; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % n]!
    if (onSegment(p, a, b)) return 'boundary'
    if (a.y <= p.y) {
      if (b.y > p.y && orient(a, b, p) > 0) winding++
    } else if (b.y <= p.y && orient(a, b, p) < 0) {
      winding--
    }
  }
  return winding !== 0 ? 'inside' : 'outside'
}

/** Центр масс многоугольника (для невырожденных; иначе — среднее вершин). */
export function centroid(poly: readonly Pt[]): Pt {
  const a2 = signedArea2(poly)
  if (a2 === 0 || poly.length < 3) {
    const n = Math.max(1, poly.length)
    return {
      x: Math.round(poly.reduce((s, p) => s + p.x, 0) / n),
      y: Math.round(poly.reduce((s, p) => s + p.y, 0) / n),
    }
  }
  const o = poly[0]!
  let cx = 0
  let cy = 0
  for (let i = 1; i < poly.length - 1; i++) {
    const p = poly[i]!
    const q = poly[i + 1]!
    const cross = (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x)
    cx += (p.x + q.x - 2 * o.x) * cross
    cy += (p.y + q.y - 2 * o.y) * cross
  }
  return { x: Math.round(o.x + cx / (3 * a2)), y: Math.round(o.y + cy / (3 * a2)) }
}

/**
 * Точка строго внутри области (контур минус дыры) — для метки помещения. Сначала центр масс;
 * если он снаружи (Г-образная комната) или в дыре — ближайшая к нему точка сетки 16×16 по
 * габариту, лежащая внутри. Не находится (контур уже сетки) — null.
 */
export function interiorPoint(
  outer: readonly Pt[],
  holes: readonly (readonly Pt[])[] = [],
): Pt | null {
  const inside = (p: Pt): boolean =>
    pointInPolygon(p, outer) === 'inside' && holes.every((h) => pointInPolygon(p, h) === 'outside')
  const c = centroid(outer)
  if (inside(c)) return c
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of outer) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const STEPS = 16
  let best: Pt | null = null
  let bestD = Infinity
  for (let i = 1; i < STEPS; i++) {
    for (let j = 1; j < STEPS; j++) {
      const p = {
        x: Math.round(minX + ((maxX - minX) * i) / STEPS),
        y: Math.round(minY + ((maxY - minY) * j) / STEPS),
      }
      if (!inside(p)) continue
      const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
  }
  return best
}
