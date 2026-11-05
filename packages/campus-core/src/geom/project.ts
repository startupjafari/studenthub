import type { Pt } from './int.js'

/**
 * Проекция точки на отрезок [a, b]: параметр t ∈ [0, 1], сама точка и расстояние до неё.
 * Для привязок и попадания курсором в стену (дробные значения — это не хранимая геометрия).
 */
export function projectOnSegment(p: Pt, a: Pt, b: Pt): { t: number; point: Pt; distance: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  const point = { x: a.x + dx * t, y: a.y + dy * t }
  return { t, point, distance: Math.hypot(p.x - point.x, p.y - point.y) }
}
