/**
 * Точные предикаты на целых миллиметрах (docs/CAMPUS_BUILDER.md §11.2).
 *
 * При |x|, |y| ≤ 10⁷ разности не больше 2·10⁷, произведения — 4·10¹⁴, разность произведений —
 * 8·10¹⁴: меньше 2^53, поэтому `orient` считается в double без единой ошибки округления.
 * Новые точки (пересечения) округляются до миллиметра — это и есть допуск модели.
 */
export interface Pt {
  x: number
  y: number
}

/** Знак поворота a→b→c: > 0 — налево (против часовой), < 0 — направо, 0 — на одной прямой. */
export function orient(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

export function samePoint(a: Pt, b: Pt): boolean {
  return a.x === b.x && a.y === b.y
}

/** Точка p лежит на отрезке [a, b] (концы включительно). */
export function onSegment(p: Pt, a: Pt, b: Pt): boolean {
  return (
    orient(a, b, p) === 0 &&
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  )
}

/** Точка p лежит строго внутри отрезка (не на концах). */
export function insideSegment(p: Pt, a: Pt, b: Pt): boolean {
  return onSegment(p, a, b) && !samePoint(p, a) && !samePoint(p, b)
}

export type SegmentContact =
  | { kind: 'none' }
  /** Общая точка: пересечение крест-накрест или касание концом. */
  | { kind: 'point'; p: Pt }
  /** Наложение на одной прямой: точки — концы каждого отрезка, лежащие на другом. */
  | { kind: 'overlap'; points: Pt[] }

/**
 * Контакт двух отрезков. Пересечение крест-накрест — с округлением точки до миллиметра;
 * касание концом и наложение — точные (точки — уже существующие концы).
 */
export function segmentContact(a: Pt, b: Pt, c: Pt, d: Pt): SegmentContact {
  const d1 = orient(c, d, a)
  const d2 = orient(c, d, b)
  const d3 = orient(a, b, c)
  const d4 = orient(a, b, d)

  if (d1 === 0 && d2 === 0 && d3 === 0 && d4 === 0) {
    const points: Pt[] = []
    for (const p of [a, b]) if (onSegment(p, c, d)) points.push(p)
    for (const p of [c, d])
      if (onSegment(p, a, b) && !points.some((q) => samePoint(q, p))) points.push(p)
    if (points.length === 0) return { kind: 'none' }
    // Касание в одной общей точке концами — это точка, а не наложение.
    if (points.length === 1) return { kind: 'point', p: points[0]! }
    return { kind: 'overlap', points }
  }

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    const t = d1 / (d1 - d2)
    return {
      kind: 'point',
      p: { x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) },
    }
  }
  if (d1 === 0 && onSegment(a, c, d)) return { kind: 'point', p: a }
  if (d2 === 0 && onSegment(b, c, d)) return { kind: 'point', p: b }
  if (d3 === 0 && onSegment(c, a, b)) return { kind: 'point', p: c }
  if (d4 === 0 && onSegment(d, a, b)) return { kind: 'point', p: d }
  return { kind: 'none' }
}

export function distance(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/**
 * Сравнение направлений по углу против часовой стрелки от оси +X, без `atan2`: сначала
 * полуплоскость (верхняя с положительной полуосью X — первой), затем знак векторного
 * произведения. Точное на целых.
 */
export function compareDirections(u: Pt, v: Pt): number {
  const hu = u.y > 0 || (u.y === 0 && u.x > 0) ? 0 : 1
  const hv = v.y > 0 || (v.y === 0 && v.x > 0) ? 0 : 1
  if (hu !== hv) return hu - hv
  const cross = u.x * v.y - u.y * v.x
  return cross > 0 ? -1 : cross < 0 ? 1 : 0
}
