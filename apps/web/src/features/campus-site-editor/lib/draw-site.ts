import { interiorPoint, type Pt, type SiteFeature } from '@studenthub/campus-core'
import { drawUnderlay, type UnderlayState } from '../../../entities/campus'
import type { SiteSelection, SiteState } from '../model/site-store'
import { buildingOutline, moveFeature } from './site-geometry'

/**
 * Отрисовка территории (§14.1) на Canvas 2D. Цвета площадных объектов приглушены — как в
 * 3D-виде, чтобы план и сцена читались одинаково.
 */
export interface SitePalette {
  background: string
  foreground: string
  muted: string
  border: string
  primary: string
}

export const SITE_FILL: Record<string, string> = {
  lawn: '#bbf7d0',
  parking: '#e2e8f0',
  sport: '#fed7aa',
  rest: '#d9f99d',
  path: '#d6d3d1',
  road: '#94a3b8',
}

export function drawSite(
  g: CanvasRenderingContext2D,
  s: SiteState,
  p: SitePalette,
  width: number,
  height: number,
  hover: SiteSelection | null,
  extra: { underlay?: UnderlayState; metres?: string } = {},
): void {
  const { scale, ox, oy } = s.view
  const sx = (x: number): number => ox + x * scale
  const sy = (y: number): number => oy - y * scale
  const path = (pts: readonly Pt[], close: boolean): void => {
    g.beginPath()
    pts.forEach((q, i) => (i === 0 ? g.moveTo(sx(q.x), sy(q.y)) : g.lineTo(sx(q.x), sy(q.y))))
    if (close) g.closePath()
  }
  const dragged = (id: string, f: SiteFeature): SiteFeature =>
    s.drag && s.selection.kind === 'feature' && s.selection.id === id ? moveFeature(f, s.drag) : f

  g.clearRect(0, 0, width, height)
  g.fillStyle = p.background
  g.fillRect(0, 0, width, height)
  if (extra.underlay) drawUnderlay(g, extra.underlay, s.view, p.primary)
  const tracing = !!extra.underlay?.image && !!extra.underlay.placement?.visible
  const unit = extra.metres ?? 'm'
  /** Подпись длины в метрах на плашке цвета фона — читается поверх линий и подложки. */
  const tag = (text: string, x: number, y: number): void => {
    g.font = '600 12px system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const w = g.measureText(text).width + 10
    g.fillStyle = p.background
    g.globalAlpha = 0.9
    g.fillRect(x - w / 2, y - 9, w, 18)
    g.globalAlpha = 1
    g.fillStyle = p.foreground
    g.fillText(text, x, y)
  }
  const metres = (a: Pt, b: Pt): string =>
    `${(Math.hypot(b.x - a.x, b.y - a.y) / 1000).toFixed(1)} ${unit}`

  // Граница территории — пунктир.
  if (s.doc.boundary.length >= 3) {
    path(s.doc.boundary, true)
    g.setLineDash([10, 6])
    g.lineWidth = s.selection.kind === 'boundary' ? 3 : 1.5
    g.strokeStyle = s.selection.kind === 'boundary' ? p.primary : p.muted
    g.stroke()
    g.setLineDash([])
  }

  const features = Object.entries(s.doc.features).map(([id, f]) => [id, dragged(id, f)] as const)
  for (const [, f] of features) {
    if (!('polygon' in f)) continue
    path(f.polygon, true)
    g.fillStyle = SITE_FILL[f.type] ?? p.border
    g.fill()
    g.lineWidth = 1
    g.strokeStyle = p.border
    g.stroke()
  }
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (const [, f] of features) {
    if (!('line' in f)) continue
    path(f.line, false)
    g.lineWidth = Math.max(2, f.widthMm * scale)
    g.strokeStyle = SITE_FILL[f.type] ?? p.border
    g.stroke()
  }
  g.lineCap = 'butt'
  g.lineJoin = 'miter'

  // Корпуса — контур с кодом в середине.
  for (const b of s.buildings) {
    const moving = s.drag && s.selection.kind === 'building' && s.selection.id === b.id
    const vd = s.vertexDrag?.id === b.id ? s.vertexDrag : null
    const outline = buildingOutline(b).map((q, i) =>
      vd && i === vd.index ? vd.to : moving ? { x: q.x + s.drag!.x, y: q.y + s.drag!.y } : q,
    )
    path(outline, true)
    g.fillStyle = p.border
    // Поверх подложки корпус полупрозрачный: обводят по снимку, и он должен просвечивать.
    g.globalAlpha = tracing ? 0.45 : 1
    g.fill()
    g.globalAlpha = 1
    g.lineWidth = 2
    g.strokeStyle = p.foreground
    g.stroke()
    // Подпись — внутри контура: у «Г» и «П» среднее вершин лежит снаружи.
    const at = interiorPoint(outline) ?? outline[0]!
    const cx = at.x
    const cy = at.y
    g.fillStyle = p.foreground
    g.font = '600 13px system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(b.code ?? b.name, sx(cx), sy(cy))
  }

  for (const [, f] of features) {
    if (f.type === 'tree') {
      g.beginPath()
      g.arc(sx(f.x), sy(f.y), Math.max(4, 2000 * scale), 0, Math.PI * 2)
      g.fillStyle = f.variant === 'conifer' ? '#15803d' : '#4ade80'
      g.fill()
    } else if (f.type === 'gate') {
      const half = (f.widthMm / 2) * scale
      g.fillStyle = p.foreground
      g.fillRect(sx(f.x) - half - 3, sy(f.y) - 3, 6, 6)
      g.fillRect(sx(f.x) + half - 3, sy(f.y) - 3, 6, 6)
      g.strokeStyle = p.foreground
      g.setLineDash([4, 3])
      g.beginPath()
      g.moveTo(sx(f.x) - half, sy(f.y))
      g.lineTo(sx(f.x) + half, sy(f.y))
      g.stroke()
      g.setLineDash([])
    } else if (f.type === 'label') {
      g.fillStyle = p.muted
      g.font = '12px system-ui, sans-serif'
      g.textAlign = 'center'
      g.fillText(f.text, sx(f.x), sy(f.y))
    }
  }

  // Выделение и наведение.
  const outlineOf = (sel: SiteSelection): Pt[] | null => {
    if (sel.kind === 'building') {
      const b = s.buildings.find((x) => x.id === sel.id)
      return b ? buildingOutline(b) : null
    }
    if (sel.kind !== 'feature') return null
    const f = s.doc.features[sel.id]
    if (!f) return null
    const moved = dragged(sel.id, f)
    if ('polygon' in moved) return moved.polygon
    if ('line' in moved) return moved.line
    return [
      { x: moved.x - 1500, y: moved.y - 1500 },
      { x: moved.x + 1500, y: moved.y - 1500 },
      { x: moved.x + 1500, y: moved.y + 1500 },
      { x: moved.x - 1500, y: moved.y + 1500 },
    ]
  }
  for (const [sel, alpha] of [
    [hover, 0.5],
    [s.selection, 1],
  ] as const) {
    if (!sel) continue
    const pts = outlineOf(sel)
    if (!pts) continue
    const f = sel.kind === 'feature' ? s.doc.features[sel.id] : null
    path(pts, !(f && 'line' in f))
    g.globalAlpha = alpha
    g.lineWidth = 2.5
    g.strokeStyle = p.primary
    g.stroke()
    g.globalAlpha = 1
  }

  // Углы выделенного корпуса — ручки: их тянут, по стороне двойным кликом добавляют угол.
  if (s.selection.kind === 'building' && !s.drag) {
    const sel = s.selection
    const b = s.buildings.find((x) => x.id === sel.id)
    if (b) {
      const ring = buildingOutline(b).map((q, i) =>
        s.vertexDrag?.id === b.id && s.vertexDrag.index === i ? s.vertexDrag.to : q,
      )
      ring.forEach((q, i) => {
        g.fillStyle = p.background
        g.strokeStyle = p.primary
        g.lineWidth = 2
        g.fillRect(sx(q.x) - 4, sy(q.y) - 4, 8, 8)
        g.strokeRect(sx(q.x) - 4, sy(q.y) - 4, 8, 8)
        // Длины сторон, пока тянут угол: видно, во что превращается корпус.
        if (s.vertexDrag?.id === b.id) {
          const r = ring[(i + 1) % ring.length]!
          tag(metres(q, r), sx((q.x + r.x) / 2), sy((q.y + r.y) / 2))
        }
      })
    }
  }

  // Корпус прямоугольником — с размерами сторон.
  if (s.rect) {
    const { a, b } = s.rect
    const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }]
    path(corners, true)
    g.fillStyle = p.primary
    g.globalAlpha = 0.12
    g.fill()
    g.globalAlpha = 1
    g.lineWidth = 2
    g.strokeStyle = p.primary
    g.setLineDash([6, 4])
    g.stroke()
    g.setLineDash([])
    tag(metres(a, { x: b.x, y: a.y }), sx((a.x + b.x) / 2), sy(a.y))
    tag(metres({ x: b.x, y: a.y }, b), sx(b.x), sy((a.y + b.y) / 2))
  }

  // Рисуемая линия: длина текущего отрезка у курсора, набранная длина — рядом.
  if (s.draft.length > 0) {
    const pts = s.cursor ? [...s.draft, s.cursor] : s.draft
    path(pts, false)
    g.lineWidth = 2
    g.strokeStyle = p.primary
    g.setLineDash([6, 4])
    g.stroke()
    g.setLineDash([])
    g.fillStyle = p.primary
    for (const q of s.draft) {
      g.beginPath()
      g.arc(sx(q.x), sy(q.y), 4, 0, Math.PI * 2)
      g.fill()
    }
    // Первая точка крупнее: в неё кликают, чтобы замкнуть контур.
    const first = s.draft[0]!
    if (s.draft.length >= 3) {
      g.beginPath()
      g.arc(sx(first.x), sy(first.y), 7, 0, Math.PI * 2)
      g.lineWidth = 2
      g.strokeStyle = p.primary
      g.stroke()
    }
    const last = s.draft.at(-1)!
    if (s.cursor && (s.cursor.x !== last.x || s.cursor.y !== last.y)) {
      tag(
        s.typed ? `${s.typed} ${unit} ↵` : metres(last, s.cursor),
        sx((last.x + s.cursor.x) / 2),
        sy((last.y + s.cursor.y) / 2) - 14,
      )
    }
  }
}
