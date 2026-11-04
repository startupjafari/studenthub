import {
  pointInPolygon,
  projectOnSegment,
  toCampus,
  type Pt,
  type SiteFeature,
  type SitePlanDoc,
} from '@studenthub/campus-core'
import type { SiteBuilding, SiteSelection } from '../model/site-store'

/** Контур корпуса на территории (с поворотом и сдвигом). */
export function buildingOutline(b: SiteBuilding): Pt[] {
  return b.outline.map((p) => toCampus(p, b.transform))
}

/** Сдвиг объекта территории на вектор — для перетаскивания целиком. */
export function moveFeature(f: SiteFeature, d: Pt): SiteFeature {
  const m = (p: Pt): Pt => ({ x: Math.round(p.x + d.x), y: Math.round(p.y + d.y) })
  if ('polygon' in f) return { ...f, polygon: f.polygon.map(m) }
  if ('line' in f) return { ...f, line: f.line.map(m) }
  return { ...f, x: Math.round(f.x + d.x), y: Math.round(f.y + d.y) }
}

function nearLine(line: readonly Pt[], p: Pt, r: number): boolean {
  for (let i = 0; i + 1 < line.length; i++) {
    if (projectOnSegment(p, line[i]!, line[i + 1]!).distance <= r) return true
  }
  return false
}

/**
 * Что под курсором: точечные объекты → линии → корпуса → площадные объекты (самый мелкий)
 * → граница. Корпус выше газона: его чаще двигают.
 */
export function hitSite(
  doc: SitePlanDoc,
  buildings: SiteBuilding[],
  p: Pt,
  r: number,
): SiteSelection {
  const entries = Object.entries(doc.features)
  for (const [id, f] of entries) {
    if ('x' in f && Math.hypot(f.x - p.x, f.y - p.y) <= r * 1.5) return { kind: 'feature', id }
  }
  for (const [id, f] of entries) {
    if ('line' in f && nearLine(f.line, p, r + f.widthMm / 2)) return { kind: 'feature', id }
  }
  for (const b of buildings) {
    if (pointInPolygon(p, buildingOutline(b)) !== 'outside') return { kind: 'building', id: b.id }
  }
  const areas = entries
    .filter(
      ([, f]) =>
        'polygon' in f && pointInPolygon(p, (f as { polygon: Pt[] }).polygon) !== 'outside',
    )
    .map(([id, f]) => ({ id, area: polygonArea((f as { polygon: Pt[] }).polygon) }))
    .sort((a, b) => a.area - b.area)
  if (areas[0]) return { kind: 'feature', id: areas[0].id }
  if (doc.boundary.length >= 3 && nearLine([...doc.boundary, doc.boundary[0]!], p, r))
    return { kind: 'boundary' }
  return { kind: 'none' }
}

export function polygonArea(poly: readonly Pt[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!
    const q = poly[(i + 1) % poly.length]!
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a / 2)
}
