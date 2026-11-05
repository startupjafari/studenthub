'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import {
  projectOnSegment,
  toBuilding,
  type BuildingTransform,
  type Pt,
  type SiteFeature,
} from '@studenthub/campus-core'
import type { UnderlayStore } from '../../../entities/campus'
import { drawSite, type SitePalette } from '../lib/draw-site'
import { buildingOutline, hitSite, moveFeature } from '../lib/site-geometry'
import type { SiteSelection, SiteStore, SiteTool } from '../model/site-store'

const POLYGON_TOOLS = new Set<SiteTool>([
  'boundary',
  'lawn',
  'parking',
  'sport',
  'rest',
  'building',
])
const LINE_TOOLS = new Set<SiteTool>(['path', 'road'])
/** Шаг привязки на территории: полметра — точнее при рисовании «с нуля» не нужно. */
const SNAP_MM = 500
/** Длина отрезка под углом прилипает к 10 см: «24.3 м», а не «24.317». */
const LENGTH_STEP_MM = 100
/** Угол отрезка прилипает к кратному 45°, если отличается меньше чем на столько. */
const ANGLE_SNAP_RAD = (7 * Math.PI) / 180
/** Протянули дальше этого — рисуется прямоугольник, иначе это клик (первый угол). */
const RECT_DRAG_PX = 6
/** Меньше по стороне — промах, а не корпус. */
const MIN_RECT_MM = 1000

function readPalette(el: Element): SitePalette {
  const css = getComputedStyle(el)
  const v = (n: string, f: string): string => css.getPropertyValue(n).trim() || f
  return {
    background: v('--background', '#fff'),
    foreground: v('--foreground', '#111'),
    muted: v('--muted-foreground', '#888'),
    border: v('--border', '#ddd'),
    primary: v('--primary', '#2563eb'),
  }
}

function newId(): string {
  return `f_${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`
}

/** Объект территории по завершённому контуру инструмента. */
function featureFor(tool: SiteTool, pts: Pt[]): SiteFeature | null {
  if (LINE_TOOLS.has(tool) && pts.length >= 2) {
    return tool === 'road'
      ? { type: 'road', line: pts, widthMm: 7000 }
      : { type: 'path', line: pts, widthMm: 3000, covered: false }
  }
  if (tool === 'lawn' || tool === 'parking' || tool === 'sport' || tool === 'rest') {
    return pts.length >= 3 ? { type: tool, polygon: pts } : null
  }
  return null
}

function rectCorners(a: Pt, b: Pt): Pt[] {
  return [
    { x: a.x, y: a.y },
    { x: b.x, y: a.y },
    { x: b.x, y: b.y },
    { x: a.x, y: b.y },
  ]
}

/**
 * Холст территории: рисование контуров кликами (двойной клик, Enter или клик в первую точку —
 * закончить), точечные объекты одним кликом, перетаскивание объектов и корпусов.
 *
 * Корпус рисуют прямо здесь — кликами по углам любой формы или протянув прямоугольник; углы
 * выделенного корпуса потом тянут мышью, двойной клик по стороне добавляет угол, по углу —
 * убирает. Отрезок прилипает к 45° (с Shift — шаг 15°), длину можно набрать с клавиатуры и
 * нажать Enter. Корпус и его контур — поля корпуса, не документ территории: их сохраняет
 * экран (`onBuildingDrawn`, `onBuildingOutline`, `onBuildingMoved`).
 */
export function SiteCanvas({
  store,
  underlay,
  onBuildingMoved,
  onBuildingDrawn,
  onBuildingOutline,
}: {
  store: SiteStore
  underlay?: UnderlayStore
  onBuildingMoved: (id: string, transform: BuildingTransform) => void
  /** Нарисован контур нового корпуса — точки в мм кампуса. */
  onBuildingDrawn: (outline: Pt[]) => void
  /** Поправили углы корпуса — новый контур в мм корпуса. */
  onBuildingOutline: (id: string, outline: Pt[]) => void
}) {
  const t = useTranslations('CampusSite')
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const callbacks = useRef({ onBuildingMoved, onBuildingDrawn, onBuildingOutline })
  callbacks.current = { onBuildingMoved, onBuildingDrawn, onBuildingOutline }

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    const g = canvas?.getContext('2d')
    if (!wrap || !canvas || !g) return
    let width = 0
    let height = 0
    let frame = 0
    let palette = readPalette(canvas)
    let hover: SiteSelection | null = null
    let fitted = false
    let dragStart: Pt | null = null
    let panning: { x: number; y: number } | null = null
    let spaceHeld = false
    let underlayHeld = false
    let rectStart: { plan: Pt; x: number; y: number } | null = null
    const pointers = new Map<number, { x: number; y: number }>()
    let pinch: { dist: number; cx: number; cy: number } | null = null

    const draw = (): void => {
      frame = 0
      const dpr = window.devicePixelRatio || 1
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawSite(g, store.getState(), palette, width, height, hover, {
        underlay: underlay?.getState(),
        metres: t('m'),
      })
    }
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(draw)
    }
    const resize = (): void => {
      const rect = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      width = rect.width
      height = rect.height
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      if (!fitted && width > 0) {
        fitted = true
        fitAll()
      }
      schedule()
    }
    // Вписать границу, корпуса и все объекты — при открытии и по кнопке «весь план».
    function fitAll(): void {
      const s = store.getState()
      store.fit(width, height, [
        ...s.doc.boundary,
        ...s.buildings.flatMap(buildingOutline),
        ...Object.values(s.doc.features).flatMap((f) =>
          'polygon' in f ? f.polygon : 'line' in f ? f.line : [{ x: f.x, y: f.y }],
        ),
      ])
    }
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize()
    let fitNonce = store.getState().fitNonce
    const unsubscribe = store.subscribe(() => {
      const n = store.getState().fitNonce
      if (n !== fitNonce) {
        fitNonce = n
        fitAll()
      }
      schedule()
    })
    const unsubscribeUnderlay = underlay?.subscribe(schedule)
    const mo = new MutationObserver(() => {
      palette = readPalette(canvas)
      schedule()
    })
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    })

    const local = (e: MouseEvent): { x: number; y: number } => {
      const r = canvas.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const rawAt = (e: MouseEvent): Pt => {
      const l = local(e)
      const p = store.toPlan(l.x, l.y)
      return { x: Math.round(p.x), y: Math.round(p.y) }
    }
    const grid = (p: Pt, alt: boolean): Pt =>
      alt ? p : { x: Math.round(p.x / SNAP_MM) * SNAP_MM, y: Math.round(p.y / SNAP_MM) * SNAP_MM }
    const planAt = (e: MouseEvent, snap: boolean): Pt => grid(rawAt(e), !snap || e.altKey)
    const radius = (e: PointerEvent | MouseEvent): number =>
      ('pointerType' in e && e.pointerType !== 'mouse' ? 22 : 8) / store.getState().view.scale

    /**
     * Следующая точка рисуемого контура: в первую точку — замкнуть; иначе отрезок прилипает
     * к кратному 45° (с Shift — 15°), длина — к 10 см, а на уровне первой точки встаёт ровно
     * на него — так прямоугольные корпуса замыкаются без зазора. Alt — без привязок.
     */
    const nextPoint = (e: MouseEvent): Pt => {
      const s = store.getState()
      const raw = rawAt(e)
      const first = s.draft[0]
      const last = s.draft.at(-1)
      const r = radius(e)
      if (first && s.draft.length >= 3 && Math.hypot(raw.x - first.x, raw.y - first.y) <= r * 1.5)
        return first
      if (!last || e.altKey) return grid(raw, e.altKey)
      const dx = raw.x - last.x
      const dy = raw.y - last.y
      const len = Math.hypot(dx, dy)
      if (len === 0) return last
      const angle = Math.atan2(dy, dx)
      const step = e.shiftKey ? Math.PI / 12 : Math.PI / 4
      const snapped = Math.round(angle / step) * step
      if (!e.shiftKey && Math.abs(angle - snapped) > ANGLE_SNAP_RAD) return grid(raw, false)
      const cos = Math.cos(snapped)
      const sin = Math.sin(snapped)
      let length = Math.round(len / LENGTH_STEP_MM) * LENGTH_STEP_MM
      // Встать на уровень первой точки: по вертикали — её y, по горизонтали — её x.
      if (first && s.draft.length >= 2) {
        if (Math.abs(cos) < 1e-6 && Math.abs(last.y + sin * length - first.y) <= r)
          length = Math.abs(first.y - last.y)
        else if (Math.abs(sin) < 1e-6 && Math.abs(last.x + cos * length - first.x) <= r)
          length = Math.abs(first.x - last.x)
      }
      return { x: Math.round(last.x + cos * length), y: Math.round(last.y + sin * length) }
    }

    /** Набранная длина: точка на ней по направлению к курсору. */
    const typedPoint = (): Pt | null => {
      const s = store.getState()
      const last = s.draft.at(-1)
      const metres = Number(s.typed)
      if (!last || !s.cursor || !(metres > 0)) return null
      const dx = s.cursor.x - last.x
      const dy = s.cursor.y - last.y
      const len = Math.hypot(dx, dy)
      if (len === 0) return null
      const mm = metres * 1000
      return { x: Math.round(last.x + (dx / len) * mm), y: Math.round(last.y + (dy / len) * mm) }
    }

    const finishWith = (tool: SiteTool, pts: Pt[]): void => {
      if (tool === 'boundary' && pts.length >= 3) {
        store.apply((doc) => ({ ...doc, boundary: pts }))
        store.set({ selection: { kind: 'boundary' } })
      } else if (tool === 'building' && pts.length >= 3) {
        callbacks.current.onBuildingDrawn(pts)
      } else {
        const f = featureFor(tool, pts)
        if (f) {
          const id = newId()
          store.setFeature(id, f)
          store.set({ selection: { kind: 'feature', id } })
        }
      }
      store.set({ draft: [], cursor: null, typed: '', rect: null })
    }
    const finish = (): void => {
      const s = store.getState()
      // Двойной клик ставит точку дважды — повтор последней не нужен.
      const pts = s.draft.filter(
        (p, i, all) => i === 0 || p.x !== all[i - 1]!.x || p.y !== all[i - 1]!.y,
      )
      finishWith(s.tool, pts)
    }

    /** Угол выделенного корпуса под курсором. */
    const vertexAt = (e: MouseEvent): { id: string; index: number } | null => {
      const s = store.getState()
      if (s.selection.kind !== 'building') return null
      const id = s.selection.id
      const b = s.buildings.find((x) => x.id === id)
      if (!b) return null
      const p = rawAt(e)
      const r = radius(e) * 1.5
      const index = buildingOutline(b).findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) <= r)
      return index >= 0 ? { id, index } : null
    }

    /** Угол тянут: привязка к сетке и к соседним углам по x и y — стороны остаются прямыми. */
    const vertexTarget = (e: MouseEvent, id: string, index: number): Pt => {
      const b = store.getState().buildings.find((x) => x.id === id)
      const p = grid(rawAt(e), e.altKey)
      if (!b || e.altKey) return p
      const ring = buildingOutline(b)
      const n = ring.length
      const r = radius(e)
      const out = { ...p }
      for (const q of [ring[(index + n - 1) % n]!, ring[(index + 1) % n]!]) {
        if (Math.abs(rawAt(e).x - q.x) <= r) out.x = q.x
        if (Math.abs(rawAt(e).y - q.y) <= r) out.y = q.y
      }
      return out
    }

    const commitOutline = (id: string, campusRing: Pt[]): void => {
      const b = store.getState().buildings.find((x) => x.id === id)
      if (!b) return
      callbacks.current.onBuildingOutline(
        id,
        campusRing.map((p) => toBuilding(p, b.transform)),
      )
    }

    const onDown = (e: PointerEvent): void => {
      const l = local(e)
      pointers.set(e.pointerId, l)
      canvas.setPointerCapture(e.pointerId)
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinch = {
          dist: Math.hypot(a!.x - b!.x, a!.y - b!.y),
          cx: (a!.x + b!.x) / 2,
          cy: (a!.y + b!.y) / 2,
        }
        dragStart = null
        rectStart = null
        return
      }
      const s = store.getState()
      if (e.button === 1 || spaceHeld || s.tool === 'pan') {
        panning = l
        return
      }
      if (e.button !== 0) return
      if (underlay?.pointer('down', rawAt(e))) {
        underlayHeld = true
        return
      }
      if (s.tool === 'select') {
        const vertex = vertexAt(e)
        if (vertex) {
          store.set({ vertexDrag: { ...vertex, to: vertexTarget(e, vertex.id, vertex.index) } })
          return
        }
        const hit = hitSite(s.doc, s.buildings, store.toPlan(l.x, l.y), radius(e))
        store.set({ selection: hit })
        if (hit.kind === 'feature' || hit.kind === 'building') dragStart = planAt(e, true)
        return
      }
      if (POLYGON_TOOLS.has(s.tool) || LINE_TOOLS.has(s.tool)) {
        // Корпус с пустого места: клик — первый угол, протянуть — прямоугольник.
        if (s.tool === 'building' && s.draft.length === 0) {
          rectStart = { plan: planAt(e, true), x: l.x, y: l.y }
          return
        }
        const p = nextPoint(e)
        const first = s.draft[0]
        if (POLYGON_TOOLS.has(s.tool) && first && s.draft.length >= 3 && p === first) {
          finish()
          return
        }
        store.set({ draft: [...s.draft, p], typed: '' })
        return
      }
      const p = planAt(e, true)
      const id = newId()
      const feature: SiteFeature | null =
        s.tool === 'tree'
          ? { type: 'tree', x: p.x, y: p.y, variant: 'deciduous' }
          : s.tool === 'gate'
            ? { type: 'gate', x: p.x, y: p.y, widthMm: 4000 }
            : s.tool === 'label'
              ? { type: 'label', x: p.x, y: p.y, text: t('newLabel') }
              : null
      if (feature) {
        store.setFeature(id, feature)
        // Дерево ставят пачкой — инструмент остаётся; ворота и надпись сразу в свойства.
        store.set({
          selection: { kind: 'feature', id },
          ...(s.tool === 'tree' ? {} : { tool: 'select' }),
        })
      }
    }

    const onMove = (e: PointerEvent): void => {
      const l = local(e)
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, l)
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()]
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y)
        const cx = (a!.x + b!.x) / 2
        const cy = (a!.y + b!.y) / 2
        store.pan(cx - pinch.cx, cy - pinch.cy)
        if (pinch.dist > 0) store.zoomAt(cx, cy, dist / pinch.dist)
        pinch = { dist, cx, cy }
        return
      }
      if (panning) {
        store.pan(l.x - panning.x, l.y - panning.y)
        panning = l
        return
      }
      if (underlayHeld) {
        underlay?.pointer('move', rawAt(e))
        return
      }
      const s = store.getState()
      if (s.vertexDrag) {
        const { id, index } = s.vertexDrag
        store.set({ vertexDrag: { id, index, to: vertexTarget(e, id, index) } })
        return
      }
      if (rectStart) {
        if (Math.hypot(l.x - rectStart.x, l.y - rectStart.y) > RECT_DRAG_PX)
          store.set({ rect: { a: rectStart.plan, b: planAt(e, true) } })
        return
      }
      if (dragStart) {
        const p = planAt(e, true)
        store.set({ drag: { x: p.x - dragStart.x, y: p.y - dragStart.y } })
        return
      }
      if (s.draft.length > 0) {
        store.set({ cursor: nextPoint(e) })
        return
      }
      if (s.tool === 'select' && e.pointerType === 'mouse') {
        if (vertexAt(e)) {
          canvas.style.cursor = 'crosshair'
          return
        }
        const next = hitSite(s.doc, s.buildings, store.toPlan(l.x, l.y), radius(e))
        const h = next.kind === 'none' ? null : next
        canvas.style.cursor = h ? 'move' : ''
        if (JSON.stringify(h) !== JSON.stringify(hover)) {
          hover = h
          schedule()
        }
      }
    }

    const onUp = (e: PointerEvent): void => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinch = null
      if (panning) {
        panning = null
        return
      }
      if (underlayHeld) {
        underlayHeld = false
        underlay?.pointer('up', rawAt(e))
        return
      }
      const s = store.getState()
      if (s.vertexDrag) {
        const { id, index, to } = s.vertexDrag
        store.set({ vertexDrag: null })
        const b = s.buildings.find((x) => x.id === id)
        if (!b) return
        const ring = buildingOutline(b)
        const from = ring[index]!
        if (from.x === to.x && from.y === to.y) return
        commitOutline(
          id,
          ring.map((q, i) => (i === index ? to : q)),
        )
        return
      }
      if (rectStart) {
        const start = rectStart
        rectStart = null
        const r = s.rect
        if (r && Math.abs(r.b.x - r.a.x) >= MIN_RECT_MM && Math.abs(r.b.y - r.a.y) >= MIN_RECT_MM) {
          finishWith('building', rectCorners(r.a, r.b))
        } else {
          store.set({ rect: null, draft: [start.plan], cursor: start.plan })
        }
        return
      }
      if (dragStart && s.drag && (s.drag.x || s.drag.y)) {
        const d = s.drag
        if (s.selection.kind === 'feature') {
          const f = s.doc.features[s.selection.id]
          if (f) store.setFeature(s.selection.id, moveFeature(f, d))
        } else if (s.selection.kind === 'building') {
          const b = s.buildings.find((x) => x.id === (s.selection as { id: string }).id)
          if (b) {
            const transform = { ...b.transform, x: b.transform.x + d.x, y: b.transform.y + d.y }
            store.setBuilding(b.id, transform)
            callbacks.current.onBuildingMoved(b.id, transform)
          }
        }
      }
      dragStart = null
      if (s.drag) store.set({ drag: null })
    }

    const onDouble = (e: MouseEvent): void => {
      const s = store.getState()
      if (s.draft.length > 0) {
        finish()
        return
      }
      // Двойной клик по углу выделенного корпуса убирает угол, по стороне — добавляет.
      if (s.tool !== 'select' || s.selection.kind !== 'building') return
      const id = s.selection.id
      const b = s.buildings.find((x) => x.id === id)
      if (!b) return
      const ring = buildingOutline(b)
      const vertex = vertexAt(e)
      if (vertex) {
        if (ring.length > 3)
          commitOutline(
            id,
            ring.filter((_, i) => i !== vertex.index),
          )
        return
      }
      const p = rawAt(e)
      const r = radius(e)
      for (let i = 0; i < ring.length; i++) {
        const hit = projectOnSegment(p, ring[i]!, ring[(i + 1) % ring.length]!)
        if (hit.distance > r || hit.t <= 0 || hit.t >= 1) continue
        const at = { x: Math.round(hit.point.x), y: Math.round(hit.point.y) }
        commitOutline(id, [...ring.slice(0, i + 1), at, ...ring.slice(i + 1)])
        return
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      if (e.code === 'Space') {
        spaceHeld = e.type === 'keydown'
        if (spaceHeld) e.preventDefault()
        return
      }
      if (e.type !== 'keydown') return
      const s = store.getState()
      if (s.draft.length > 0 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Длина следующего отрезка с клавиатуры: цифры, точка или запятая, Backspace.
        if (/^[0-9]$/.test(e.key) || ((e.key === '.' || e.key === ',') && !s.typed.includes('.'))) {
          e.preventDefault()
          e.stopImmediatePropagation()
          store.set({ typed: s.typed + (e.key === ',' ? '.' : e.key) })
          return
        }
        if (e.key === 'Backspace' && s.typed) {
          e.preventDefault()
          e.stopImmediatePropagation()
          store.set({ typed: s.typed.slice(0, -1) })
          return
        }
      }
      if (e.key === 'Enter' && s.draft.length > 0) {
        e.preventDefault()
        const p = s.typed ? typedPoint() : null
        if (p) store.set({ draft: [...s.draft, p], typed: '', cursor: p })
        else finish()
      }
    }
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const l = local(e)
      if (e.shiftKey && !e.ctrlKey) store.pan(-e.deltaY, 0)
      else store.zoomAt(l.x, l.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('dblclick', onDouble)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      ro.disconnect()
      mo.disconnect()
      unsubscribe()
      unsubscribeUnderlay?.()
      if (frame) cancelAnimationFrame(frame)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('dblclick', onDouble)
      canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [store, underlay, t])

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t('canvasLabel')}
        className="block touch-none select-none"
      />
    </div>
  )
}
