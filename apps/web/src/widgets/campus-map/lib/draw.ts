import { pointInPolygon, type Pt, type SitePlanDoc, type SpaceKind } from '@studenthub/campus-core'
import type { FloorModel, MapSpace } from './model'
import { isCirculation, spaceFill, type MapPalette } from './palette'

/** Корпус на карте: его этаж на выбранном уровне (если есть) и контур в мм кампуса. */
export interface MapBuilding {
  id: string
  code: string | null
  name: string
  outline: Pt[]
  floorId: string | null
  model: FloorModel | null
}

export interface MapScene {
  site: SitePlanDoc | null
  buildings: MapBuilding[]
  selected: { floorId: string; spaceId: string } | null
  /** Маршрут на этом уровне — ломаные в мм кампуса. */
  route: Pt[][]
  kindLabel: (kind: SpaceKind) => string
}

export interface MapView {
  /** Пикселей на миллиметр. */
  scale: number
  ox: number
  oy: number
}

const ICON_PX = 18
/** Номера кабинетов — только когда помещение на экране не меньше этого. */
const NUMBER_MIN_PX = 26
/** Ниже этого масштаба вместо плана — подписи корпусов. */
const DETAIL_SCALE = 0.0035
const POI_KINDS: readonly SpaceKind[] = ['canteen', 'library', 'sport_hall', 'hall', 'other']

type Box = { x0: number; y0: number; x1: number; y1: number }

export function drawMap(
  g: CanvasRenderingContext2D,
  scene: MapScene,
  view: MapView,
  p: MapPalette,
  width: number,
  height: number,
): void {
  const sx = (x: number): number => view.ox + x * view.scale
  const sy = (y: number): number => view.oy - y * view.scale
  const poly = (pts: readonly Pt[]): void => {
    pts.forEach((q, i) => (i === 0 ? g.moveTo(sx(q.x), sy(q.y)) : g.lineTo(sx(q.x), sy(q.y))))
    g.closePath()
  }
  const line = (pts: readonly Pt[]): void => {
    g.beginPath()
    pts.forEach((q, i) => (i === 0 ? g.moveTo(sx(q.x), sy(q.y)) : g.lineTo(sx(q.x), sy(q.y))))
  }

  g.clearRect(0, 0, width, height)
  g.fillStyle = p.ground
  g.fillRect(0, 0, width, height)

  // ── Территория ──────────────────────────────────────────────────────────────────
  const features = Object.values(scene.site?.features ?? {})
  const areaFill: Record<string, string> = {
    lawn: p.lawn,
    parking: p.parking,
    sport: p.sport,
    rest: p.rest,
  }
  for (const f of features) {
    if (!('polygon' in f)) continue
    g.beginPath()
    poly(f.polygon)
    g.fillStyle = areaFill[f.type] ?? p.lawn
    g.fill()
  }
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (const f of features) {
    if (f.type !== 'road') continue
    line(f.line)
    g.lineWidth = Math.max(3, f.widthMm * view.scale)
    g.strokeStyle = p.road
    g.stroke()
  }
  for (const f of features) {
    if (f.type !== 'path') continue
    const w = Math.max(2, f.widthMm * view.scale)
    line(f.line)
    g.lineWidth = w + 2
    g.strokeStyle = p.pathEdge
    g.stroke()
    line(f.line)
    g.lineWidth = w
    g.strokeStyle = p.path
    g.stroke()
  }
  if (scene.site && scene.site.boundary.length >= 3) {
    g.beginPath()
    poly(scene.site.boundary)
    g.setLineDash([6, 5])
    g.lineWidth = 1.2
    g.strokeStyle = p.boundary
    g.stroke()
    g.setLineDash([])
  }
  for (const f of features) {
    if (f.type !== 'tree') continue
    const r = Math.max(2.5, 2200 * view.scale)
    g.beginPath()
    g.arc(sx(f.x), sy(f.y), r, 0, Math.PI * 2)
    g.fillStyle = p.tree
    g.fill()
    g.lineWidth = 1
    g.strokeStyle = p.treeEdge
    g.stroke()
  }

  // ── Корпуса ─────────────────────────────────────────────────────────────────────
  const detailed = view.scale >= DETAIL_SCALE
  for (const b of scene.buildings) {
    g.beginPath()
    poly(b.outline)
    if (!b.model) {
      // Корпуса нет на этом уровне (или план не загружен) — силуэт, как в 2ГИС.
      g.fillStyle = p.absent
      g.fill()
      g.lineWidth = 1
      g.strokeStyle = p.absentEdge
      g.stroke()
      continue
    }
    g.fillStyle = p.slab
    g.fill()
    for (const s of b.model.spaces) {
      g.beginPath()
      poly(s.outer)
      for (const h of s.holes) poly(h)
      g.fillStyle = spaceFill(s.space.kind, p)
      g.fill('evenodd')
      if (detailed && !isCirculation(s.space.kind)) {
        g.lineWidth = 1.5
        g.strokeStyle = p.separator
        g.stroke()
      }
    }
    if (detailed) {
      g.lineWidth = 1
      g.strokeStyle = p.innerWall
      g.beginPath()
      for (const [a, c] of b.model.innerWalls) {
        g.moveTo(sx(a.x), sy(a.y))
        g.lineTo(sx(c.x), sy(c.y))
      }
      g.stroke()
    }
    g.beginPath()
    poly(b.outline)
    g.lineWidth = 1.6
    g.strokeStyle = p.outerWall
    g.stroke()
  }

  // Выделенное помещение.
  const selected = scene.selected
  if (selected) {
    const b = scene.buildings.find((x) => x.floorId === selected.floorId)
    const s = b?.model?.spaces.find((x) => x.id === selected.spaceId)
    if (s) {
      g.beginPath()
      poly(s.outer)
      g.fillStyle = p.primary
      g.globalAlpha = 0.35
      g.fill()
      g.globalAlpha = 1
      g.lineWidth = 2.5
      g.strokeStyle = p.primary
      g.stroke()
    }
  }

  // Маршрут — с белой обводкой, чтобы читался поверх любой заливки.
  for (const r of scene.route) {
    if (r.length < 2) continue
    line(r)
    g.lineWidth = 7
    g.strokeStyle = p.halo
    g.stroke()
    line(r)
    g.lineWidth = 4
    g.strokeStyle = p.primary
    g.stroke()
  }
  const firstRoute = scene.route[0]
  const lastRoute = scene.route.at(-1)
  for (const q of [firstRoute?.[0], lastRoute?.at(-1)]) {
    if (!q) continue
    g.beginPath()
    g.arc(sx(q.x), sy(q.y), 6, 0, Math.PI * 2)
    g.fillStyle = p.primary
    g.fill()
    g.lineWidth = 2
    g.strokeStyle = p.halo
    g.stroke()
  }

  // ── Иконки и подписи — без наложений: что не влезло, то не рисуем ──────────────────
  const placed: Box[] = []
  const free = (bx: Box): boolean =>
    bx.x1 > 0 &&
    bx.y1 > 0 &&
    bx.x0 < width &&
    bx.y0 < height &&
    !placed.some((o) => bx.x0 < o.x1 && bx.x1 > o.x0 && bx.y0 < o.y1 && bx.y1 > o.y0)

  if (!detailed) {
    // Издалека — подписи корпусов.
    for (const b of scene.buildings) {
      const c = centroid(b.outline)
      label(g, b.code ?? b.name, sx(c.x), sy(c.y), p, 600, 12, placed, free)
    }
    return
  }

  const icon = (
    x: number,
    y: number,
    kind: 'stairs' | 'elevator' | 'entrance' | 'restroom' | 'food',
  ): boolean => {
    const h = ICON_PX / 2
    const bx = { x0: x - h, y0: y - h, x1: x + h, y1: y + h }
    if (!free(bx)) return false
    placed.push(bx)
    drawIcon(g, x, y, kind, p)
    return true
  }
  for (const b of scene.buildings) {
    if (!b.model) continue
    const others = scene.buildings.filter((o) => o !== b)
    for (const ic of b.model.icons) {
      // Дверь в соседний корпус — переход, а не вход с улицы: значок входа не ставим.
      if (
        ic.kind === 'entrance' &&
        others.some((o) => pointInPolygon(ic.at, o.outline) !== 'outside')
      )
        continue
      icon(sx(ic.at.x), sy(ic.at.y), ic.kind)
    }
  }
  for (const b of scene.buildings) {
    if (!b.model) continue
    for (const s of b.model.spaces) {
      const x = sx(s.label.x)
      const y = sy(s.label.y)
      if (s.space.kind === 'restroom') {
        icon(x, y, 'restroom')
        continue
      }
      if (s.space.kind === 'canteen') {
        if (icon(x, y - 8, 'food') && s.space.name)
          label(g, s.space.name, x, y + 10, p, 600, 11, placed, free)
        continue
      }
      const text = roomText(s, scene.kindLabel)
      if (!text) continue
      const w = (s.box.x1 - s.box.x0) * view.scale
      const hgt = (s.box.y1 - s.box.y0) * view.scale
      const poi = POI_KINDS.includes(s.space.kind) && !!s.space.name
      if (!poi && (w < NUMBER_MIN_PX || hgt < 14)) continue
      if (poi) {
        // Место с названием — точка и подпись, как метки 2ГИС.
        g.beginPath()
        g.arc(x, y - 6, 3.5, 0, Math.PI * 2)
        g.fillStyle = p.text
        g.fill()
        label(g, text, x, y + 7, p, 600, 11, placed, free)
      } else {
        label(g, text, x, y, p, 600, 11, placed, free, w - 4)
      }
    }
  }
}

function roomText(s: MapSpace, kindLabel: (k: SpaceKind) => string): string | null {
  if (s.space.number) return s.space.number
  if (s.space.name) return s.space.name
  if (isCirculation(s.space.kind)) return null
  return kindLabel(s.space.kind)
}

function centroid(pts: readonly Pt[]): Pt {
  const n = pts.length || 1
  return {
    x: pts.reduce((a, q) => a + q.x, 0) / n,
    y: pts.reduce((a, q) => a + q.y, 0) / n,
  }
}

/** Подпись с ореолом цвета фона; не влезает в `maxWidth` или занято место — не рисуем. */
function label(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  p: MapPalette,
  weight: number,
  size: number,
  placed: Box[],
  free: (b: Box) => boolean,
  maxWidth?: number,
): void {
  g.font = `${weight} ${size}px system-ui, sans-serif`
  const w = g.measureText(text).width
  if (maxWidth !== undefined && w > maxWidth) return
  const bx = { x0: x - w / 2 - 2, y0: y - size / 2 - 2, x1: x + w / 2 + 2, y1: y + size / 2 + 2 }
  if (!free(bx)) return
  placed.push(bx)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineWidth = 3
  g.strokeStyle = p.halo
  g.lineJoin = 'round'
  g.strokeText(text, x, y)
  g.fillStyle = p.text
  g.fillText(text, x, y)
}

/** Значки в квадрате со скруглением: лестница, лифт, вход, туалет, еда. */
function drawIcon(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: 'stairs' | 'elevator' | 'entrance' | 'restroom' | 'food',
  p: MapPalette,
): void {
  const h = ICON_PX / 2
  g.beginPath()
  g.roundRect(x - h, y - h, ICON_PX, ICON_PX, 4)
  g.fillStyle = kind === 'entrance' ? p.entrance : kind === 'restroom' ? p.muted : p.badge
  g.fill()
  g.strokeStyle = '#ffffff'
  g.fillStyle = '#ffffff'
  g.lineWidth = 1.6
  g.lineCap = 'round'
  g.lineJoin = 'round'
  switch (kind) {
    case 'stairs':
      g.beginPath()
      g.moveTo(x - 5, y + 5)
      g.lineTo(x - 5, y + 2)
      g.lineTo(x - 1.5, y + 2)
      g.lineTo(x - 1.5, y - 1.5)
      g.lineTo(x + 2, y - 1.5)
      g.lineTo(x + 2, y - 5)
      g.lineTo(x + 5, y - 5)
      g.stroke()
      break
    case 'elevator':
      g.beginPath()
      g.moveTo(x - 5, y - 1)
      g.lineTo(x - 2.5, y - 5)
      g.lineTo(x, y - 1)
      g.closePath()
      g.fill()
      g.beginPath()
      g.moveTo(x + 0.5, y + 1)
      g.lineTo(x + 3, y + 5)
      g.lineTo(x + 5.5, y + 1)
      g.closePath()
      g.fill()
      break
    case 'entrance':
      g.beginPath()
      g.moveTo(x - 5, y)
      g.lineTo(x + 2, y)
      g.moveTo(x - 1, y - 3)
      g.lineTo(x + 2, y)
      g.lineTo(x - 1, y + 3)
      g.moveTo(x + 5, y - 5)
      g.lineTo(x + 5, y + 5)
      g.stroke()
      break
    case 'restroom':
      g.font = '700 8px system-ui, sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText('WC', x, y + 0.5)
      break
    case 'food':
      g.beginPath()
      g.moveTo(x - 3, y - 5)
      g.lineTo(x - 3, y + 5)
      g.moveTo(x - 5, y - 5)
      g.lineTo(x - 5, y - 1)
      g.lineTo(x - 1, y - 1)
      g.lineTo(x - 1, y - 5)
      g.moveTo(x + 3, y + 5)
      g.lineTo(x + 3, y - 5)
      g.quadraticCurveTo(x + 5.5, y - 3, x + 3, y)
      g.stroke()
      break
  }
}
