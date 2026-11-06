import type { FloorPlanDoc } from '../format/schema.js'
import type { Pt } from '../geom/int.js'
import { toCampus, type BuildingTransform } from '../topology/building.js'

/**
 * Путь по оси проходов (docs/CAMPUS_BUILDER.md §15). Граф видимости даёт кратчайший путь —
 * он прижимается к стенам и срезает углы в 30–45 см от них. Для линии на карте и камеры
 * прохода это выглядит как «идти вдоль стены»; здесь участок пути внутри этажа сдвигается на
 * середину прохода: каждая точка — посередине между стенами слева и справа. В широких
 * пространствах (зал, холл), где середины нет, путь отходит от ближней стены на PREFERRED_MM.
 */

/** Стена этажа в мм кампуса: ось и полутолщина. */
export interface CenterWall {
  a: Pt
  b: Pt
  half: number
}

/** Шаг точек вдоль пути. */
const STEP_MM = 1000
/** Дальше этого стену сбоку не ищем. */
const MAX_RAY_MM = 4000
/** Проход шире — это зал, не коридор: середину не ищем. */
const MAX_WIDTH_MM = 6000
/** У концов участка (двери, площадки) путь не трогаем — он должен прийти точно в них. */
const KEEP_NEAR_MM = 700
/** Ближе к стене после сдвига не подходим (если исходный путь не был ближе). */
const MIN_CLEAR_MM = 250
/**
 * Стена только с одного бока (холл, коридор вдоль открытого пространства) — держимся от неё
 * на таком расстоянии: как ось коридора шириной 2,2 м, а не впритирку.
 */
const PREFERRED_MM = 1100

/** Стены этажа в мм кампуса (виртуальные — открытые границы зон — не стены). */
export function centerWalls(doc: FloorPlanDoc, transform: BuildingTransform): CenterWall[] {
  const out: CenterWall[] = []
  for (const w of Object.values(doc.walls)) {
    if (w.kind === 'virtual') continue
    const a = doc.nodes[w.a]
    const b = doc.nodes[w.b]
    if (!a || !b) continue
    out.push({ a: toCampus(a, transform), b: toCampus(b, transform), half: w.thicknessMm / 2 })
  }
  return out
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

/** Расстояние от точки до отрезка. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

/** До ближайшей стены по лучу p + t·d (d — единичный), с учётом толщины; нет — Infinity. */
function ray(p: Pt, d: Pt, walls: readonly CenterWall[]): number {
  let best = Infinity
  for (const w of walls) {
    const ex = w.b.x - w.a.x
    const ey = w.b.y - w.a.y
    const den = d.x * ey - d.y * ex
    if (Math.abs(den) < 1e-9) continue
    const ax = w.a.x - p.x
    const ay = w.a.y - p.y
    const t = (ax * ey - ay * ex) / den
    const u = (ax * d.y - ay * d.x) / den
    if (t <= 0 || u < 0 || u > 1) continue
    // Грань стены, а не её ось: поправка на толщину под углом луча к стене.
    const sin = Math.abs(den) / Math.hypot(ex, ey)
    const face = t - w.half / Math.max(sin, 0.3)
    if (face < best) best = face
  }
  return best <= MAX_RAY_MM ? best : Infinity
}

/** Зазор отрезка p–q до стен (до грани); пересекает стену — −1. */
function clearance(p: Pt, q: Pt, walls: readonly CenterWall[]): number {
  let best = Infinity
  for (const w of walls) {
    if (properIntersect(p, q, w.a, w.b)) return -1
    const near =
      Math.min(segDist(w.a, p, q), segDist(w.b, p, q), segDist(p, w.a, w.b), segDist(q, w.a, w.b)) -
      w.half
    if (near < best) best = near
  }
  return best
}

/**
 * Участок пути внутри одного этажа (концы — двери, площадки, метки помещений) → тот же путь
 * по середине проходов. Концы и точки рядом с ними не двигаются. Сдвинутая точка, из-за
 * которой отрезок задел бы стену, возвращается на место: путь никогда не хуже исходного.
 */
export function centerPath(pts: readonly Pt[], walls: readonly CenterWall[]): Pt[] {
  if (pts.length < 2 || walls.length === 0) return [...pts]
  // 1. Точки через STEP_MM вдоль пути, с пройденной длиной — чтобы знать, где концы.
  const total = pts
    .slice(1)
    .reduce((s, p, i) => s + Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y), 0)
  const base: { p: Pt; s: number }[] = []
  let s = 0
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const n = Math.max(1, Math.round(len / STEP_MM))
    for (let k = 0; k < n; k++) {
      base.push({
        p: { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n },
        s: s + (len * k) / n,
      })
    }
    s += len
  }
  base.push({ p: pts[pts.length - 1]!, s: total })
  const fixed = base.map(({ s: at }) => at < KEEP_NEAR_MM || total - at < KEEP_NEAR_MM)

  // 2. Каждую точку — на середину между стенами слева и справа (поперёк хода).
  const moved = base.map(({ p }, i) => {
    if (fixed[i]) return p
    const prev = base[i - 1]!.p
    const next = base[i + 1]!.p
    const tx = next.x - prev.x
    const ty = next.y - prev.y
    const len = Math.hypot(tx, ty)
    if (len < 1) return p
    const n = { x: -ty / len, y: tx / len }
    const left = ray(p, n, walls)
    const right = ray(p, { x: -n.x, y: -n.y }, walls)
    let shift = 0
    if (Number.isFinite(left) && Number.isFinite(right) && left + right <= MAX_WIDTH_MM) {
      // Проход: точно посередине.
      shift = (left - right) / 2
    } else if (Number.isFinite(left) || Number.isFinite(right)) {
      // Стена с одного бока (или проход шире коридора) — отойти от ближней, но не дальше.
      const near = Math.min(left, right)
      if (near < PREFERRED_MM) shift = (near === left ? -1 : 1) * (PREFERRED_MM - near)
    }
    return { x: p.x + n.x * shift, y: p.y + n.y * shift }
  })

  // 3. Сгладить: соседние точки по-разному «видят» стены у дверных проёмов и углов.
  let out = moved
  for (let pass = 0; pass < 2; pass++) {
    out = out.map((p, i) =>
      fixed[i] || i === 0 || i === out.length - 1
        ? p
        : {
            x: (out[i - 1]!.x + 2 * p.x + out[i + 1]!.x) / 4,
            y: (out[i - 1]!.y + 2 * p.y + out[i + 1]!.y) / 4,
          },
    )
  }

  // 4. Проверка: отрезок пересёк стену или подошёл к ней ближе, чем исходный (и ближе
  // MIN_CLEAR_MM), — его сдвинутые концы назад на исходный путь, пока всё не чисто.
  const result = out.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))
  const original = base.map(({ p }) => ({ x: Math.round(p.x), y: Math.round(p.y) }))
  const same = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y
  for (let pass = 0; pass < 6; pass++) {
    let changed = false
    for (let i = 1; i < result.length; i++) {
      const a = result[i - 1]!
      const b = result[i]!
      if (same(a, original[i - 1]!) && same(b, original[i]!)) continue
      const was = clearance(original[i - 1]!, original[i]!, walls)
      const now = clearance(a, b, walls)
      if (now >= 0 && now >= Math.min(MIN_CLEAR_MM, was) - 1) continue
      for (const j of [i - 1, i]) {
        if (!same(result[j]!, original[j]!)) {
          result[j] = original[j]!
          changed = true
        }
      }
    }
    if (!changed) break
  }

  // 5. Лишние точки на прямой не нужны: линия и камера идут по тем же отрезкам.
  const simple: Pt[] = [result[0]!]
  for (let i = 1; i + 1 < result.length; i++) {
    const a = simple[simple.length - 1]!
    const b = result[i]!
    const c = result[i + 1]!
    const area = Math.abs(cross(a, b, c))
    const len = Math.hypot(c.x - a.x, c.y - a.y)
    if (len > 0 && area / len < 30) continue
    simple.push(b)
  }
  simple.push(result[result.length - 1]!)
  return simple
}
