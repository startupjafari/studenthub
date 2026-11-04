import type { Face, FloorPlanDoc, Problem, Pt, SpaceKind } from '@studenthub/campus-core'
import { SPACE_KIND_COLOR, drawUnderlay, type UnderlayState } from '../../../entities/campus'
import type { EditorState, Selection } from '../model/store'
import { wallPoints } from './hit'

/**
 * Отрисовка плана этажа на Canvas 2D (docs/CAMPUS_BUILDER.md §12.3). Один проход на кадр без
 * собственного дерева сцены: на этаже в 3000 стен кадр — единицы миллисекунд, а правка
 * перерисовывает всё через requestAnimationFrame. Подписи помещений — тоже здесь, а не DOM:
 * сотни подписей в DOM при панорамировании дергали бы раскладку.
 */
export interface Palette {
  background: string
  foreground: string
  muted: string
  border: string
  primary: string
  destructive: string
  warning: string
}

/** Цвета темы из CSS-переменных — холст сам их не видит. */
export function readPalette(el: Element): Palette {
  const css = getComputedStyle(el)
  const v = (name: string, fallback: string): string =>
    css.getPropertyValue(name).trim() || fallback
  return {
    background: v('--background', '#fff'),
    foreground: v('--foreground', '#111'),
    muted: v('--muted-foreground', '#888'),
    border: v('--border', '#ddd'),
    primary: v('--primary', '#2563eb'),
    destructive: v('--destructive', '#dc2626'),
    warning: v('--warning', '#f59e0b'),
  }
}

interface Ctx {
  g: CanvasRenderingContext2D
  s: EditorState
  p: Palette
  /** План (мм) → холст (CSS px). */
  sx: (x: number) => number
  sy: (y: number) => number
}

/** Шаг сетки: самый мелкий из «круглых», что не уже 14 px на экране. */
export function gridStep(scale: number): number {
  for (const step of [100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000, 100_000]) {
    if (step * scale >= 14) return step
  }
  return 100_000
}

export function drawPlan(
  g: CanvasRenderingContext2D,
  s: EditorState,
  p: Palette,
  width: number,
  height: number,
  options: {
    hoverSelection?: Selection
    showNodes: boolean
    problemsShown: boolean
    /** Подпись помещения без номера и названия — по типу («Аудитория»). */
    kindLabel?: (kind: SpaceKind) => string
    /** Сетка нужна при рисовании; в просмотре карты она только шумит. */
    showGrid?: boolean
    /** Снимок или план под чертежом — только в редакторе. */
    underlay?: UnderlayState
  },
): void {
  const { scale, ox, oy } = s.view
  const c: Ctx = { g, s, p, sx: (x) => ox + x * scale, sy: (y) => oy - y * scale }
  g.clearRect(0, 0, width, height)
  g.fillStyle = p.background
  g.fillRect(0, 0, width, height)
  if (options.underlay) drawUnderlay(g, options.underlay, s.view, p.primary)
  if (options.showGrid !== false) drawGrid(c, width, height)
  drawFaces(c)
  drawWalls(c)
  drawOpenings(c)
  drawVerticals(c)
  drawLabels(c, options.kindLabel)
  if (options.showNodes) drawNodes(c)
  if (options.hoverSelection) drawSelection(c, options.hoverSelection, true)
  drawSelection(c, s.selection, false)
  if (options.problemsShown) drawProblems(c, s.problems)
  drawPreview(c)
  drawRoute(c)
}

function drawGrid({ g, s, p, sx, sy }: Ctx, width: number, height: number): void {
  const { scale, ox, oy } = s.view
  const step = gridStep(scale)
  const major = step * 5
  const x0 = Math.floor(-ox / scale / step) * step
  const x1 = Math.ceil((width - ox) / scale / step) * step
  const y0 = Math.floor((oy - height) / scale / step) * step
  const y1 = Math.ceil(oy / scale / step) * step
  g.lineWidth = 1
  for (let pass = 0; pass < 2; pass += 1) {
    g.strokeStyle = p.border
    g.globalAlpha = pass === 0 ? 0.45 : 0.9
    g.beginPath()
    for (let x = x0; x <= x1; x += step) {
      if ((x % major === 0) !== (pass === 1)) continue
      const px = Math.round(sx(x)) + 0.5
      g.moveTo(px, 0)
      g.lineTo(px, height)
    }
    for (let y = y0; y <= y1; y += step) {
      if ((y % major === 0) !== (pass === 1)) continue
      const py = Math.round(sy(y)) + 0.5
      g.moveTo(0, py)
      g.lineTo(width, py)
    }
    g.stroke()
  }
  g.globalAlpha = 1
}

function ringPath({ g, sx, sy }: Ctx, points: readonly Pt[]): void {
  points.forEach((pt, i) => (i === 0 ? g.moveTo(sx(pt.x), sy(pt.y)) : g.lineTo(sx(pt.x), sy(pt.y))))
  g.closePath()
}

function facePath(c: Ctx, face: Face): void {
  c.g.beginPath()
  ringPath(c, face.outer.points)
  for (const h of face.holes) if (h.points.length >= 3) ringPath(c, h.points)
}

function drawFaces(c: Ctx): void {
  const { g, s, p } = c
  for (const face of s.faces) {
    const spaceId = s.faceSpace[face.id]
    const space = spaceId ? s.doc.spaces[spaceId] : undefined
    facePath(c, face)
    if (space) {
      g.fillStyle = SPACE_KIND_COLOR[space.kind]
      g.globalAlpha = space.visibility === 'hidden' ? 0.08 : 0.18
    } else {
      // Замкнутая область без помещения — кандидат «Создать помещение»: бледная штриховка.
      g.fillStyle = p.muted
      g.globalAlpha = 0.06
    }
    g.fill('evenodd')
    g.globalAlpha = 1
  }
}

function drawWalls(c: Ctx): void {
  const { g, s, p, sx, sy } = c
  g.lineCap = 'butt'
  for (const pass of ['virtual', 'glass', 'wall'] as const) {
    for (const [id, w] of Object.entries(s.doc.walls)) {
      if (w.kind !== pass) continue
      const pts = wallPoints(s.doc, id)
      if (!pts) continue
      const [a, b] = pts
      g.beginPath()
      g.moveTo(sx(a.x), sy(a.y))
      g.lineTo(sx(b.x), sy(b.y))
      if (pass === 'virtual') {
        g.setLineDash([6, 4])
        g.lineWidth = 1.25
        g.strokeStyle = p.muted
      } else {
        g.setLineDash([])
        g.lineWidth = Math.max(pass === 'glass' ? 1.5 : 2, w.thicknessMm * s.view.scale)
        g.strokeStyle = pass === 'glass' ? '#38bdf8' : p.foreground
      }
      g.stroke()
    }
  }
  g.setLineDash([])
  // Узлы стыков — квадраты толщины стены: без них углы в толстых стенах «рвутся».
  g.fillStyle = p.foreground
  const deg = new Map<string, number>()
  for (const w of Object.values(s.doc.walls)) {
    if (w.kind !== 'wall') continue
    const half = (w.thicknessMm * s.view.scale) / 2
    for (const n of [w.a, w.b]) deg.set(n, Math.max(deg.get(n) ?? 0, half))
  }
  for (const [id, half] of deg) {
    const n = s.doc.nodes[id]
    if (!n || half < 1) continue
    g.fillRect(sx(n.x) - half, sy(n.y) - half, half * 2, half * 2)
  }
}

/** Точка на стене по смещению от узла `a`, мм. */
function along(a: Pt, b: Pt, offsetMm: number): Pt {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return { x: a.x + ((b.x - a.x) * offsetMm) / len, y: a.y + ((b.y - a.y) * offsetMm) / len }
}

export function drawOpeningShape(
  c: Ctx,
  a: Pt,
  b: Pt,
  thicknessMm: number,
  o: { type: 'door' | 'window'; offsetMm: number; widthMm: number; swing?: string },
  ghost: boolean,
): void {
  const { g, s, p, sx, sy } = c
  const from = along(a, b, o.offsetMm)
  const to = along(a, b, o.offsetMm + o.widthMm)
  // Проём вырезан из стены цветом фона.
  g.beginPath()
  g.moveTo(sx(from.x), sy(from.y))
  g.lineTo(sx(to.x), sy(to.y))
  g.lineWidth = Math.max(2, thicknessMm * s.view.scale) + 1
  g.strokeStyle = p.background
  g.globalAlpha = 1
  g.stroke()
  g.strokeStyle = ghost ? p.primary : p.foreground
  g.lineWidth = 1.25
  if (o.type === 'window') {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = (-(b.y - a.y) / len) * (thicknessMm / 4)
    const ny = ((b.x - a.x) / len) * (thicknessMm / 4)
    for (const k of [-1, 1]) {
      g.beginPath()
      g.moveTo(sx(from.x + nx * k), sy(from.y + ny * k))
      g.lineTo(sx(to.x + nx * k), sy(to.y + ny * k))
      g.stroke()
    }
    return
  }
  if (o.swing === 'none' || o.swing === 'sliding') {
    g.setLineDash([4, 3])
    g.beginPath()
    g.moveTo(sx(from.x), sy(from.y))
    g.lineTo(sx(to.x), sy(to.y))
    g.stroke()
    g.setLineDash([])
    return
  }
  // Распашная: полотно перпендикулярно стене и дуга открывания (план — ось Y вверх).
  const hinge = o.swing?.startsWith('right') ? to : from
  const free = o.swing?.startsWith('right') ? from : to
  const side = o.swing?.endsWith('out') ? -1 : 1
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const nx = (-(b.y - a.y) / len) * side
  const ny = ((b.x - a.x) / len) * side
  const leaf = { x: hinge.x + nx * o.widthMm, y: hinge.y + ny * o.widthMm }
  g.beginPath()
  g.moveTo(sx(hinge.x), sy(hinge.y))
  g.lineTo(sx(leaf.x), sy(leaf.y))
  g.stroke()
  const r = o.widthMm * s.view.scale
  const angFree = Math.atan2(-(free.y - hinge.y), free.x - hinge.x)
  const angLeaf = Math.atan2(-(leaf.y - hinge.y), leaf.x - hinge.x)
  let d = angLeaf - angFree
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  g.beginPath()
  g.arc(sx(hinge.x), sy(hinge.y), r, angFree, angLeaf, d < 0)
  g.globalAlpha = 0.6
  g.stroke()
  g.globalAlpha = 1
}

function drawOpenings(c: Ctx): void {
  const { s } = c
  for (const o of Object.values(s.doc.openings)) {
    if (!o.wallId) continue
    const pts = wallPoints(s.doc, o.wallId)
    const w = s.doc.walls[o.wallId]
    if (!pts || !w) continue
    drawOpeningShape(
      c,
      pts[0],
      pts[1],
      w.thicknessMm,
      {
        type: o.type,
        offsetMm: o.offsetMm,
        widthMm: o.widthMm,
        swing: o.type === 'door' ? o.swing : undefined,
      },
      false,
    )
  }
}

function drawVerticals(c: Ctx): void {
  const { g, s, p, sx, sy } = c
  for (const v of Object.values(s.doc.verticals)) {
    const pts = v.outline.map(([x, y]) => ({ x, y }))
    g.beginPath()
    ringPath(c, pts)
    g.fillStyle = p.background
    g.fill()
    g.strokeStyle = p.foreground
    g.lineWidth = 1.25
    g.stroke()
    g.save()
    g.beginPath()
    ringPath(c, pts)
    g.clip()
    g.globalAlpha = 0.7
    const xs = pts.map((q) => q.x)
    const ys = pts.map((q) => q.y)
    const [minX, maxX, minY, maxY] = [
      Math.min(...xs),
      Math.max(...xs),
      Math.min(...ys),
      Math.max(...ys),
    ]
    g.beginPath()
    if (v.type === 'elevator') {
      g.moveTo(sx(minX), sy(minY))
      g.lineTo(sx(maxX), sy(maxY))
      g.moveTo(sx(minX), sy(maxY))
      g.lineTo(sx(maxX), sy(minY))
    } else {
      // Ступени поперёк длинной стороны, шаг 300 мм.
      const horizontal = maxX - minX >= maxY - minY
      const step = v.type === 'ramp' ? 1200 : 300
      if (horizontal)
        for (let x = minX + step; x < maxX; x += step) {
          g.moveTo(sx(x), sy(minY))
          g.lineTo(sx(x), sy(maxY))
        }
      else
        for (let y = minY + step; y < maxY; y += step) {
          g.moveTo(sx(minX), sy(y))
          g.lineTo(sx(maxX), sy(y))
        }
    }
    g.stroke()
    g.restore()
    g.globalAlpha = 1
    g.fillStyle = p.primary
    g.beginPath()
    g.arc(sx(v.landing.x), sy(v.landing.y), 3.5, 0, Math.PI * 2)
    g.fill()
  }
}

function drawLabels(c: Ctx, kindLabel?: (kind: SpaceKind) => string): void {
  const { g, s, p, sx, sy } = c
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const faceBySpace = new Map(Object.entries(s.faceSpace).map(([f, sp]) => [sp, f]))
  const area = new Map(s.faces.map((f) => [f.id, f.areaMm2]))
  for (const [id, sp] of Object.entries(s.doc.spaces)) {
    const faceId = faceBySpace.get(id)
    // Подпись не шире помещения: на мелком масштабе у маленьких комнат она исчезает.
    const sidePx = Math.sqrt(faceId ? (area.get(faceId) ?? 0) : 0) * s.view.scale
    if (sidePx < 28) continue
    const x = sx(sp.label.x)
    const y = sy(sp.label.y)
    const title = sp.number || sp.name || ''
    g.fillStyle = faceId ? (title ? p.foreground : p.muted) : p.destructive
    if (!title) {
      g.font = '12px system-ui, sans-serif'
      g.fillText(faceId && kindLabel ? truncate(g, kindLabel(sp.kind), sidePx - 8) : '?', x, y)
      continue
    }
    g.font = '600 12px system-ui, sans-serif'
    g.fillText(title, x, y - (sp.number && sp.name ? 7 : 0))
    if (sp.number && sp.name && sidePx > 70) {
      g.fillStyle = p.muted
      g.font = '11px system-ui, sans-serif'
      g.fillText(truncate(g, sp.name, sidePx - 8), x, y + 8)
    }
  }
  g.font = '12px system-ui, sans-serif'
  g.fillStyle = p.muted
  for (const l of Object.values(s.doc.labels)) g.fillText(l.text, sx(l.x), sy(l.y))
}

function truncate(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t}…`
}

function drawNodes({ g, s, p, sx, sy }: Ctx): void {
  if (s.view.scale < 0.02) return
  g.fillStyle = p.background
  g.strokeStyle = p.primary
  g.lineWidth = 1
  for (const n of Object.values(s.doc.nodes)) {
    g.beginPath()
    g.rect(sx(n.x) - 2.5, sy(n.y) - 2.5, 5, 5)
    g.fill()
    g.stroke()
  }
}

function drawSelection(c: Ctx, sel: Selection, hover: boolean): void {
  const { g, s, p, sx, sy } = c
  g.strokeStyle = p.primary
  g.fillStyle = p.primary
  g.globalAlpha = hover ? 0.5 : 1
  g.lineWidth = hover ? 2 : 3
  switch (sel.kind) {
    case 'wall': {
      const pts = wallPoints(s.doc, sel.id)
      if (!pts) break
      g.beginPath()
      g.moveTo(sx(pts[0].x), sy(pts[0].y))
      g.lineTo(sx(pts[1].x), sy(pts[1].y))
      g.stroke()
      if (!hover) for (const q of pts) handle(c, q)
      break
    }
    case 'node': {
      const n = s.doc.nodes[sel.id]
      if (n) handle(c, n)
      break
    }
    case 'opening': {
      const o = s.doc.openings[sel.id]
      const pts = o?.wallId ? wallPoints(s.doc, o.wallId) : null
      if (!o || !pts) break
      const from = along(pts[0], pts[1], o.offsetMm)
      const to = along(pts[0], pts[1], o.offsetMm + o.widthMm)
      g.beginPath()
      g.moveTo(sx(from.x), sy(from.y))
      g.lineTo(sx(to.x), sy(to.y))
      g.lineWidth = 6
      g.globalAlpha = hover ? 0.3 : 0.5
      g.stroke()
      break
    }
    case 'space':
    case 'face': {
      const faceId =
        sel.kind === 'face'
          ? sel.id
          : Object.entries(s.faceSpace).find(([, sp]) => sp === sel.id)?.[0]
      const face = s.faces.find((f) => f.id === faceId)
      if (!face) break
      facePath(c, face)
      g.globalAlpha = hover ? 0.08 : 0.14
      g.fill('evenodd')
      g.globalAlpha = hover ? 0.5 : 1
      g.lineWidth = 2
      g.stroke()
      break
    }
    case 'vertical': {
      const v = s.doc.verticals[sel.id]
      if (!v) break
      g.beginPath()
      ringPath(
        c,
        v.outline.map(([x, y]) => ({ x, y })),
      )
      g.stroke()
      break
    }
    case 'label': {
      const l = s.doc.labels[sel.id]
      if (l) handle(c, l)
      break
    }
    default:
      break
  }
  g.globalAlpha = 1
}

/** Ручка выделения. На тач-экране попадание шире (§12.11), рисуется она одинаково. */
function handle({ g, p, sx, sy }: Ctx, q: Pt): void {
  g.save()
  g.globalAlpha = 1
  g.fillStyle = p.background
  g.strokeStyle = p.primary
  g.lineWidth = 2
  g.beginPath()
  g.arc(sx(q.x), sy(q.y), 6, 0, Math.PI * 2)
  g.fill()
  g.stroke()
  g.restore()
}

/** Где на плане показать проблему: по первому объекту из её пути. */
export function problemPoint(doc: FloorPlanDoc, problem: Problem): Pt | null {
  const [kind, id] = problem.path.split('.')
  if (!id) return null
  if (kind === 'nodes') return doc.nodes[id] ?? null
  if (kind === 'walls') {
    const pts = wallPoints(doc, id)
    return pts ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : null
  }
  if (kind === 'openings') {
    const o = doc.openings[id]
    const pts = o?.wallId ? wallPoints(doc, o.wallId) : null
    return o && pts ? along(pts[0], pts[1], o.offsetMm + o.widthMm / 2) : null
  }
  if (kind === 'spaces') return doc.spaces[id]?.label ?? null
  if (kind === 'verticals') return doc.verticals[id]?.landing ?? null
  return null
}

function drawProblems({ g, s, p, sx, sy }: Ctx, problems: Problem[]): void {
  for (const pr of problems) {
    const pt = problemPoint(s.doc, pr)
    if (!pt) continue
    g.beginPath()
    g.arc(sx(pt.x), sy(pt.y), 7, 0, Math.PI * 2)
    g.strokeStyle = pr.severity === 'error' ? p.destructive : p.warning
    g.lineWidth = 2
    g.stroke()
  }
}

function drawPreview(c: Ctx): void {
  const { g, s, p, sx, sy } = c
  const pv = s.preview
  g.strokeStyle = p.primary
  g.fillStyle = p.primary
  if (pv.wall) {
    g.lineWidth = Math.max(2, 200 * s.view.scale)
    g.globalAlpha = 0.6
    g.beginPath()
    g.moveTo(sx(pv.wall.a.x), sy(pv.wall.a.y))
    g.lineTo(sx(pv.wall.b.x), sy(pv.wall.b.y))
    g.stroke()
    g.globalAlpha = 1
    dimension(c, pv.wall.a, pv.wall.b)
  }
  if (pv.rect) {
    const { a, b } = pv.rect
    g.globalAlpha = 0.12
    g.fillRect(
      sx(Math.min(a.x, b.x)),
      sy(Math.max(a.y, b.y)),
      Math.abs(b.x - a.x) * s.view.scale,
      Math.abs(b.y - a.y) * s.view.scale,
    )
    g.globalAlpha = 1
    g.lineWidth = 2
    g.strokeRect(
      sx(Math.min(a.x, b.x)),
      sy(Math.max(a.y, b.y)),
      Math.abs(b.x - a.x) * s.view.scale,
      Math.abs(b.y - a.y) * s.view.scale,
    )
    dimension(c, { x: a.x, y: Math.min(a.y, b.y) }, { x: b.x, y: Math.min(a.y, b.y) })
    dimension(c, { x: Math.max(a.x, b.x), y: a.y }, { x: Math.max(a.x, b.x), y: b.y })
  }
  if (pv.opening) {
    const pts = wallPoints(s.doc, pv.opening.wallId)
    const w = s.doc.walls[pv.opening.wallId]
    if (pts && w) {
      drawOpeningShape(
        c,
        pts[0],
        pts[1],
        w.thicknessMm,
        {
          type: pv.opening.type,
          offsetMm: pv.opening.offsetMm,
          widthMm: pv.opening.widthMm,
          swing: 'left-in',
        },
        true,
      )
    }
  }
  if (pv.drag) {
    g.beginPath()
    g.arc(sx(pv.drag.to.x), sy(pv.drag.to.y), 6, 0, Math.PI * 2)
    g.lineWidth = 2
    g.stroke()
  }
  if (pv.measure) {
    g.setLineDash([5, 4])
    g.lineWidth = 1.5
    g.beginPath()
    g.moveTo(sx(pv.measure.a.x), sy(pv.measure.a.y))
    g.lineTo(sx(pv.measure.b.x), sy(pv.measure.b.y))
    g.stroke()
    g.setLineDash([])
    dimension(c, pv.measure.a, pv.measure.b)
  }
  if (pv.cursor) {
    const x = sx(pv.cursor.x)
    const y = sy(pv.cursor.y)
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(x - 8, y)
    g.lineTo(x + 8, y)
    g.moveTo(x, y - 8)
    g.lineTo(x, y + 8)
    g.stroke()
  }
}

/** Размерная подпись в метрах у середины отрезка. */
function dimension({ g, p, sx, sy }: Ctx, a: Pt, b: Pt): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  if (len < 1) return
  const text = `${(len / 1000).toFixed(2)} м`
  const x = sx((a.x + b.x) / 2)
  const y = sy((a.y + b.y) / 2) - 14
  g.font = '600 11px system-ui, sans-serif'
  const w = g.measureText(text).width + 10
  g.fillStyle = p.foreground
  g.globalAlpha = 0.85
  g.beginPath()
  g.roundRect(x - w / 2, y - 9, w, 18, 6)
  g.fill()
  g.globalAlpha = 1
  g.fillStyle = p.background
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, x, y)
}

/** Маршрут: линия с подложкой цвета фона, точки начала и конца участка этажа. */
function drawRoute({ g, s, p, sx, sy }: Ctx): void {
  if (s.route.length === 0) return
  g.lineJoin = 'round'
  g.lineCap = 'round'
  for (const [width, color] of [
    [9, p.background],
    [5, p.primary],
  ] as const) {
    g.strokeStyle = color
    g.lineWidth = width
    for (const line of s.route) {
      if (line.length < 2) continue
      g.beginPath()
      line.forEach((pt, i) =>
        i === 0 ? g.moveTo(sx(pt.x), sy(pt.y)) : g.lineTo(sx(pt.x), sy(pt.y)),
      )
      g.stroke()
    }
  }
  g.lineCap = 'butt'
  g.lineJoin = 'miter'
  for (const line of s.route) {
    for (const pt of [line[0], line.at(-1)]) {
      if (!pt) continue
      g.beginPath()
      g.arc(sx(pt.x), sy(pt.y), 7, 0, Math.PI * 2)
      g.fillStyle = p.background
      g.fill()
      g.lineWidth = 3
      g.strokeStyle = p.primary
      g.stroke()
    }
  }
}
