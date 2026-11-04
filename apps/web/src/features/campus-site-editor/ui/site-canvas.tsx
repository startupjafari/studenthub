'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import type { BuildingTransform, Pt, SiteFeature } from '@studenthub/campus-core'
import { drawSite, type SitePalette } from '../lib/draw-site'
import { buildingOutline, hitSite, moveFeature } from '../lib/site-geometry'
import type { SiteSelection, SiteStore, SiteTool } from '../model/site-store'

const POLYGON_TOOLS = new Set<SiteTool>(['boundary', 'lawn', 'parking', 'sport', 'rest'])
const LINE_TOOLS = new Set<SiteTool>(['path', 'road'])
/** Шаг привязки на территории: полметра — точнее при рисовании «с нуля» не нужно. */
const SNAP_MM = 500

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
  if (POLYGON_TOOLS.has(tool) && tool !== 'boundary' && pts.length >= 3) {
    return { type: tool as 'lawn' | 'parking' | 'sport' | 'rest', polygon: pts }
  }
  return null
}

/**
 * Холст территории: рисование контуров кликами (двойной клик или Enter — закончить),
 * точечные объекты одним кликом, перетаскивание объектов и корпусов. Корпус после переноса
 * сохраняется отдельным запросом (`onBuildingMoved`): это поле корпуса, не документ территории.
 */
export function SiteCanvas({
  store,
  onBuildingMoved,
}: {
  store: SiteStore
  onBuildingMoved: (id: string, transform: BuildingTransform) => void
}) {
  const t = useTranslations('CampusSite')
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const movedRef = useRef(onBuildingMoved)
  movedRef.current = onBuildingMoved

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
    const pointers = new Map<number, { x: number; y: number }>()
    let pinch: { dist: number; cx: number; cy: number } | null = null

    const draw = (): void => {
      frame = 0
      const dpr = window.devicePixelRatio || 1
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawSite(g, store.getState(), palette, width, height, hover)
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
        const s = store.getState()
        store.fit(width, height, [
          ...s.doc.boundary,
          ...s.buildings.flatMap(buildingOutline),
          ...Object.values(s.doc.features).flatMap((f) =>
            'polygon' in f ? f.polygon : 'line' in f ? f.line : [{ x: f.x, y: f.y }],
          ),
        ])
      }
      schedule()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize()
    const unsubscribe = store.subscribe(schedule)
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
    const planAt = (e: MouseEvent, snap: boolean): Pt => {
      const l = local(e)
      const p = store.toPlan(l.x, l.y)
      return snap && !e.altKey
        ? { x: Math.round(p.x / SNAP_MM) * SNAP_MM, y: Math.round(p.y / SNAP_MM) * SNAP_MM }
        : { x: Math.round(p.x), y: Math.round(p.y) }
    }
    const radius = (e: PointerEvent | MouseEvent): number =>
      ('pointerType' in e && e.pointerType !== 'mouse' ? 22 : 8) / store.getState().view.scale

    const finish = (): void => {
      const s = store.getState()
      const pts = s.draft
      if (s.tool === 'boundary' && pts.length >= 3) {
        store.apply((doc) => ({ ...doc, boundary: pts }))
        store.set({ selection: { kind: 'boundary' } })
      } else {
        const f = featureFor(s.tool, pts)
        if (f) {
          const id = newId()
          store.setFeature(id, f)
          store.set({ selection: { kind: 'feature', id } })
        }
      }
      store.set({ draft: [], cursor: null })
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
        return
      }
      const s = store.getState()
      if (e.button === 1 || spaceHeld || s.tool === 'pan') {
        panning = l
        return
      }
      if (e.button !== 0) return
      if (s.tool === 'select') {
        const hit = hitSite(s.doc, s.buildings, store.toPlan(l.x, l.y), radius(e))
        store.set({ selection: hit })
        if (hit.kind === 'feature' || hit.kind === 'building') dragStart = planAt(e, true)
        return
      }
      const p = planAt(e, true)
      if (POLYGON_TOOLS.has(s.tool) || LINE_TOOLS.has(s.tool)) {
        store.set({ draft: [...s.draft, p] })
        return
      }
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
      const s = store.getState()
      if (dragStart) {
        const p = planAt(e, true)
        store.set({ drag: { x: p.x - dragStart.x, y: p.y - dragStart.y } })
        return
      }
      if (s.draft.length > 0) {
        store.set({ cursor: planAt(e, true) })
        return
      }
      if (s.tool === 'select' && e.pointerType === 'mouse') {
        const next = hitSite(s.doc, s.buildings, store.toPlan(l.x, l.y), radius(e))
        const h = next.kind === 'none' ? null : next
        if (JSON.stringify(h) !== JSON.stringify(hover)) {
          hover = h
          canvas.style.cursor = h ? 'move' : ''
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
      const s = store.getState()
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
            movedRef.current(b.id, transform)
          }
        }
      }
      dragStart = null
      if (s.drag) store.set({ drag: null })
    }

    const onDouble = (): void => {
      if (store.getState().draft.length > 0) finish()
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
      if (e.key === 'Enter' && store.getState().draft.length > 0) {
        e.preventDefault()
        finish()
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
  }, [store, t])

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
