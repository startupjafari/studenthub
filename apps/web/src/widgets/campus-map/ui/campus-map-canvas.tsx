'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import {
  toCampus,
  type BuildingTransform,
  type FloorPlanDoc,
  type Pt,
  type SitePlanDoc,
  type SpaceKind,
} from '@studenthub/campus-core'
import { drawMap, type MapBuilding, type MapView } from '../lib/draw'
import { floorModel, spaceAt } from '../lib/model'
import { isPickable, mapPalette } from '../lib/palette'

export interface MapBuildingInput {
  id: string
  code: string | null
  name: string
  /** Контур в мм корпуса и его положение на территории. */
  outline: Pt[]
  transform: BuildingTransform
  /** Этаж корпуса на выбранном уровне и его план (если корпус там есть и план загружен). */
  floorId: string | null
  doc: FloorPlanDoc | null
}

/** Масштаб, ближе которого подвод к помещению не увеличивает. */
const FOCUS_SCALE = 0.03
/** Сдвиг дальше этого — перетаскивание, а не клик. */
const CLICK_PX = 5
/**
 * Колесо: мелкий шаг (щелчок ≈ 10 %), сам зум доезжает плавно — накопленное гасится по
 * экспоненте за ~0,2 с. Щипок тачпада (wheel + ctrl) идёт мелкими порциями — коэффициент больше.
 */
const WHEEL_STEP = 0.001
const WHEEL_PINCH = 0.01
const WHEEL_SMOOTH = 14
/** Шаг клавиш: сдвиг в пикселях экрана и множитель масштаба. */
const KEY_PAN_PX = 80
const KEY_ZOOM = 1.25

/**
 * Карта кампуса в духе 2ГИС: на выбранном уровне видны все корпуса сразу — у кого этот этаж
 * есть, тот нарисован планом (помещения цветом, разделители, иконки лестниц, лифтов, входов и
 * туалетов, подписи по масштабу), у кого нет — силуэтом. Под корпусами — территория.
 * Клик выбирает помещение в любом корпусе; перетаскивание, колесо и щипок двигают карту,
 * двойной клик приближает. С клавиатуры (холст в фокусе): стрелки / WASD — сдвиг, + и − —
 * масштаб, 0 / Home — показать всё.
 */
export function CampusMapCanvas({
  buildings,
  site,
  selected,
  route,
  routeEnds,
  focus,
  onPick,
  label,
}: {
  buildings: MapBuildingInput[]
  site: SitePlanDoc | null
  selected: { floorId: string; spaceId: string } | null
  route: Pt[][]
  /** Начало и конец маршрута на этом уровне — булавки А и Б. */
  routeEnds?: { a: Pt | null; b: Pt | null; labels: { a: string; b: string } }
  /** Подвести карту к помещению: меняется `nonce` — карта едет к нему. */
  focus: { floorId: string; spaceId: string; nonce: number } | null
  /** Клик по помещению; по пустому месту — `null`: снять выделение. */
  onPick: (hit: { floorId: string; spaceId: string } | null) => void
  label: string
}) {
  const t = useTranslations('CampusEditor')
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef<MapView | null>(null)
  const sizeRef = useRef({ width: 0, height: 0 })
  const frameRef = useRef(0)
  const darkRef = useRef(false)
  // Сцена — в ref: холст перерисовывается по кадру, а не через ререндер React.
  const sceneRef = useRef({ buildings, site, selected, route, routeEnds })
  sceneRef.current = { buildings, site, selected, route, routeEnds }
  const pickRef = useRef(onPick)
  pickRef.current = onPick
  const kindLabelRef = useRef((k: SpaceKind) => t(`kind_${k}`))
  kindLabelRef.current = (k: SpaceKind) => t(`kind_${k}`)

  const mapBuildings = (): MapBuilding[] =>
    sceneRef.current.buildings.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      outline: b.outline.map((p) => toCampus(p, b.transform)),
      floorId: b.floorId,
      model: b.doc ? floorModel(b.doc, b.transform) : null,
    }))

  const draw = (): void => {
    frameRef.current = 0
    const canvas = canvasRef.current
    const g = canvas?.getContext('2d')
    const view = viewRef.current
    if (!canvas || !g || !view) return
    const dpr = window.devicePixelRatio || 1
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const s = sceneRef.current
    drawMap(
      g,
      {
        site: s.site,
        buildings: mapBuildings(),
        selected: s.selected,
        route: s.route,
        routeEnds: s.routeEnds,
        kindLabel: kindLabelRef.current,
      },
      view,
      mapPalette(darkRef.current),
      sizeRef.current.width,
      sizeRef.current.height,
    )
  }
  const schedule = (): void => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(draw)
  }

  /** Вписать все корпуса и территорию. */
  const fitAll = (): void => {
    const { width, height } = sizeRef.current
    const pts = [
      ...sceneRef.current.buildings.flatMap((b) => b.outline.map((p) => toCampus(p, b.transform))),
    ]
    if (!pts.length || !width) return
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const pad = 40
    const scale = Math.min(
      (width - pad * 2) / Math.max(1, x1 - x0),
      (height - pad * 2) / Math.max(1, y1 - y0),
    )
    viewRef.current = {
      scale,
      ox: (width - (x1 - x0) * scale) / 2 - x0 * scale,
      oy: (height + (y1 - y0) * scale) / 2 + y0 * scale,
    }
  }

  // Холст, размеры, тема, жесты — один раз.
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const readTheme = (): void => {
      darkRef.current = document.documentElement.classList.contains('dark')
    }
    readTheme()
    const resize = (): void => {
      const r = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      sizeRef.current = { width: r.width, height: r.height }
      canvas.width = Math.round(r.width * dpr)
      canvas.height = Math.round(r.height * dpr)
      canvas.style.width = `${r.width}px`
      canvas.style.height = `${r.height}px`
      if (!viewRef.current) fitAll()
      schedule()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize()
    const mo = new MutationObserver(() => {
      readTheme()
      schedule()
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    const pointers = new Map<number, { x: number; y: number }>()
    let pinch: { dist: number; cx: number; cy: number } | null = null
    let down: { x: number; y: number; moved: boolean } | null = null
    const local = (e: MouseEvent): { x: number; y: number } => {
      const r = canvas.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const toPlan = (l: { x: number; y: number }): Pt => {
      const v = viewRef.current!
      return { x: (l.x - v.ox) / v.scale, y: -(l.y - v.oy) / v.scale }
    }
    const zoomAt = (x: number, y: number, k: number): void => {
      const v = viewRef.current
      if (!v) return
      const scale = Math.min(0.5, Math.max(0.0005, v.scale * k))
      const f = scale / v.scale
      viewRef.current = { scale, ox: x - (x - v.ox) * f, oy: y - (y - v.oy) * f }
      schedule()
    }
    const pan = (dx: number, dy: number): void => {
      const v = viewRef.current
      if (!v) return
      viewRef.current = { ...v, ox: v.ox + dx, oy: v.oy + dy }
      schedule()
    }
    const hit = (l: { x: number; y: number }): { floorId: string; spaceId: string } | null => {
      if (!viewRef.current) return null
      const p = toPlan(l)
      for (const b of mapBuildings()) {
        if (!b.model || !b.floorId) continue
        const s = spaceAt(b.model, p)
        if (s && isPickable(s.space.kind)) return { floorId: b.floorId, spaceId: s.id }
      }
      return null
    }

    const onDown = (e: PointerEvent): void => {
      stopWheel()
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
        down = null
        return
      }
      down = { ...l, moved: false }
    }
    const onMove = (e: PointerEvent): void => {
      const l = local(e)
      const prev = pointers.get(e.pointerId)
      if (prev) pointers.set(e.pointerId, l)
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()]
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y)
        const cx = (a!.x + b!.x) / 2
        const cy = (a!.y + b!.y) / 2
        pan(cx - pinch.cx, cy - pinch.cy)
        if (pinch.dist > 0) zoomAt(cx, cy, dist / pinch.dist)
        pinch = { dist, cx, cy }
        return
      }
      if (down && prev) {
        if (!down.moved && Math.hypot(l.x - down.x, l.y - down.y) > CLICK_PX) down.moved = true
        if (down.moved) pan(l.x - prev.x, l.y - prev.y)
        return
      }
      if (e.pointerType === 'mouse') canvas.style.cursor = hit(l) ? 'pointer' : ''
    }
    const onUp = (e: PointerEvent): void => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinch = null
      if (down && !down.moved) pickRef.current(hit(local(e)))
      down = null
    }
    // Плавный зум колесом: событие копит сдвиг, кадры отдают его частями к точке под курсором.
    let wheelPending = 0
    let wheelAt = { x: 0, y: 0 }
    let wheelFrame = 0
    let wheelLast = 0
    const wheelStep = (now: number): void => {
      const dt = wheelLast ? Math.min(0.05, (now - wheelLast) / 1000) : 1 / 60
      wheelLast = now
      const take =
        Math.abs(wheelPending) < 1e-3
          ? wheelPending
          : wheelPending * (1 - Math.exp(-dt * WHEEL_SMOOTH))
      wheelPending -= take
      zoomAt(wheelAt.x, wheelAt.y, Math.exp(take))
      if (Math.abs(wheelPending) < 1e-4) {
        wheelPending = 0
        wheelFrame = 0
        wheelLast = 0
      } else wheelFrame = requestAnimationFrame(wheelStep)
    }
    const stopWheel = (): void => {
      if (wheelFrame) cancelAnimationFrame(wheelFrame)
      wheelFrame = 0
      wheelLast = 0
      wheelPending = 0
    }
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const l = local(e)
      if (e.shiftKey && !e.ctrlKey) {
        pan(-e.deltaY, 0)
        return
      }
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1
      wheelPending = Math.max(
        -2,
        Math.min(2, wheelPending - e.deltaY * unit * (e.ctrlKey ? WHEEL_PINCH : WHEEL_STEP)),
      )
      wheelAt = l
      if (!wheelFrame) wheelFrame = requestAnimationFrame(wheelStep)
    }
    const onDblClick = (e: MouseEvent): void => {
      const l = local(e)
      zoomAt(l.x, l.y, 2)
    }
    // По `code` — не зависит от раскладки: WASD работает и на русской.
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const { width, height } = sizeRef.current
      const moves: Record<string, [number, number]> = {
        ArrowUp: [0, KEY_PAN_PX],
        KeyW: [0, KEY_PAN_PX],
        ArrowDown: [0, -KEY_PAN_PX],
        KeyS: [0, -KEY_PAN_PX],
        ArrowLeft: [KEY_PAN_PX, 0],
        KeyA: [KEY_PAN_PX, 0],
        ArrowRight: [-KEY_PAN_PX, 0],
        KeyD: [-KEY_PAN_PX, 0],
      }
      const move = moves[e.code]
      if (move) pan(move[0], move[1])
      else if (e.code === 'Equal' || e.code === 'NumpadAdd') zoomAt(width / 2, height / 2, KEY_ZOOM)
      else if (e.code === 'Minus' || e.code === 'NumpadSubtract')
        zoomAt(width / 2, height / 2, 1 / KEY_ZOOM)
      else if (e.code === 'Home' || e.code === 'Digit0' || e.code === 'Numpad0') {
        fitAll()
        schedule()
      } else return
      e.preventDefault()
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('dblclick', onDblClick)
    canvas.addEventListener('keydown', onKey)
    return () => {
      ro.disconnect()
      mo.disconnect()
      // Сброс обязателен: в StrictMode эффект монтируется дважды, и «кадр уже запланирован»
      // от первого прогона навсегда блокировал бы перерисовку.
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
      stopWheel()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('dblclick', onDblClick)
      canvas.removeEventListener('keydown', onKey)
    }
    // Жесты и размеры — на всё время жизни холста; данные читаются из ref.
  }, [])

  // Данные сменились — перерисовать.
  useEffect(() => {
    if (!viewRef.current) fitAll()
    schedule()
  }, [buildings, site, selected, route, routeEnds])

  // Подвести к помещению (поиск, шаг маршрута, ссылка): по центру, крупно. Один раз на
  // запрос — пока план нужного корпуса не пришёл, ждём его, а потом карту двигает человек.
  const focusedNonce = useRef<number | null>(null)
  useEffect(() => {
    if (!focus || focusedNonce.current === focus.nonce) return
    const b = buildings.find((x) => x.floorId === focus.floorId)
    if (!b?.doc) return
    const s = floorModel(b.doc, b.transform).spaces.find((x) => x.id === focus.spaceId)
    const v = viewRef.current
    if (!s || !v) return
    focusedNonce.current = focus.nonce
    const { width, height } = sizeRef.current
    const scale = Math.max(v.scale, FOCUS_SCALE)
    viewRef.current = {
      scale,
      ox: width / 2 - s.label.x * scale,
      oy: height / 2 + s.label.y * scale,
    }
    schedule()
  }, [focus, buildings])

  return (
    // Рамка фокуса — у обёртки, внутрь: клавиши карты работают, пока холст в фокусе.
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden has-[canvas:focus-visible]:ring-4 has-[canvas:focus-visible]:ring-ring/30 has-[canvas:focus-visible]:ring-inset"
    >
      <canvas
        ref={canvasRef}
        role="img"
        tabIndex={0}
        aria-label={label}
        className="block touch-none select-none focus-visible:outline-none"
      />
    </div>
  )
}
