'use client'

import { useSyncExternalStore } from 'react'
import type { BuildingTransform, Pt, SiteFeature, SitePlanDoc } from '@studenthub/campus-core'
import { MOTION, prefersReducedMotion } from '../../../shared/lib'

/**
 * Состояние редактора территории (docs/CAMPUS_BUILDER.md §14.1). Устроено как у редактора
 * этажа: класс вне React, срезы через `useSite(selector)`, история — ссылки на неизменяемые
 * документы. Корпуса — не часть документа территории: их положение хранится в таблице
 * корпусов и сохраняется отдельно (PATCH корпуса), здесь — только для показа и перетаскивания.
 */
export type SiteTool =
  | 'select'
  | 'boundary'
  | 'path'
  | 'road'
  | 'lawn'
  | 'parking'
  | 'sport'
  | 'rest'
  | 'tree'
  | 'gate'
  | 'label'
  | 'building'
  | 'pan'

export type SiteSelection =
  | { kind: 'none' }
  | { kind: 'feature'; id: string }
  | { kind: 'building'; id: string }
  | { kind: 'boundary' }

export type SiteSaveState = 'saved' | 'dirty' | 'saving' | 'offline' | 'conflict'

export interface SiteBuilding {
  id: string
  name: string
  code: string | null
  outline: Pt[]
  transform: BuildingTransform
}

export interface SiteState {
  doc: SitePlanDoc
  revision: number
  buildings: SiteBuilding[]
  selection: SiteSelection
  tool: SiteTool
  view: { scale: number; ox: number; oy: number }
  /** Точки рисуемой линии или многоугольника и курсор. */
  draft: Pt[]
  cursor: Pt | null
  /** Перетаскивание: сдвиг выделенного объекта в мм. */
  drag: Pt | null
  /** Длина следующего отрезка, набранная с клавиатуры, в метрах («24», «12.5»). */
  typed: string
  /** Угол корпуса, который тянут: новое положение в мм кампуса. */
  vertexDrag: { id: string; index: number; to: Pt } | null
  /** Корпус прямоугольником: протянули мышью от угла до угла. */
  rect: { a: Pt; b: Pt } | null
  saveState: SiteSaveState
  canUndo: boolean
  canRedo: boolean
  /** Запрос «вписать всё»: холст знает свой размер и пересчитывает вид, когда число растёт. */
  fitNonce: number
  /** Запрос «показать объект»: точки его контура в мм; холст подводит к ним вид. */
  focusReq: { points: Pt[]; nonce: number } | null
}

/** Свободная от плавающих панелей часть холста — отступы от краёв в пикселях. */
export interface ViewInsets {
  left: number
  top: number
  right: number
  bottom: number
}

const HISTORY_LIMIT = 100
const MIN_SCALE = 0.0002
const MAX_SCALE = 0.5
/** Точечный объект (дерево, ворота) показываем с округой не меньше этой, мм. */
const MIN_FOCUS_MM = 20_000
/** Отступ от границ объекта до края свободной области, px. */
const FOCUS_PAD = 32
const FLIGHT_MS = MOTION.large * 1.5

export class SiteStore {
  private state: SiteState
  private readonly listeners = new Set<() => void>()
  private past: SitePlanDoc[] = []
  private future: SitePlanDoc[] = []

  constructor(doc: SitePlanDoc, revision: number, buildings: SiteBuilding[]) {
    this.state = {
      doc,
      revision,
      buildings,
      selection: { kind: 'none' },
      tool: 'select',
      view: { scale: 0.005, ox: 40, oy: 40 },
      draft: [],
      cursor: null,
      drag: null,
      typed: '',
      vertexDrag: null,
      rect: null,
      saveState: 'saved',
      canUndo: false,
      canRedo: false,
      fitNonce: 0,
      focusReq: null,
    }
  }

  getState = (): SiteState => this.state

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  set(patch: Partial<SiteState>): void {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }

  apply(op: (doc: SitePlanDoc) => SitePlanDoc): void {
    const before = this.state.doc
    const after = op(before)
    if (after === before) return
    this.past.push(before)
    if (this.past.length > HISTORY_LIMIT) this.past.shift()
    this.future = []
    this.set({ doc: after, saveState: 'dirty', canUndo: true, canRedo: false })
  }

  undo(): void {
    const prev = this.past.pop()
    if (!prev) return
    this.future.push(this.state.doc)
    this.set({
      doc: prev,
      saveState: 'dirty',
      canUndo: this.past.length > 0,
      canRedo: true,
      selection: { kind: 'none' },
    })
  }

  redo(): void {
    const next = this.future.pop()
    if (!next) return
    this.past.push(this.state.doc)
    this.set({
      doc: next,
      saveState: 'dirty',
      canUndo: true,
      canRedo: this.future.length > 0,
      selection: { kind: 'none' },
    })
  }

  replace(doc: SitePlanDoc, revision: number): void {
    this.past = []
    this.future = []
    this.set({
      doc,
      revision,
      saveState: 'saved',
      canUndo: false,
      canRedo: false,
      selection: { kind: 'none' },
    })
  }

  setFeature(id: string, feature: SiteFeature): void {
    this.apply((doc) => ({ ...doc, features: { ...doc.features, [id]: feature } }))
  }

  removeFeature(id: string): void {
    this.apply((doc) => {
      const { [id]: _, ...features } = doc.features
      return { ...doc, features }
    })
  }

  setBuilding(id: string, transform: BuildingTransform): void {
    this.set({
      buildings: this.state.buildings.map((b) => (b.id === id ? { ...b, transform } : b)),
    })
  }

  /** Новый контур корпуса (мм корпуса) — после правки углов; сохраняет вид экран. */
  setBuildingOutline(id: string, outline: Pt[]): void {
    this.set({
      buildings: this.state.buildings.map((b) => (b.id === id ? { ...b, outline } : b)),
    })
  }

  addBuilding(b: SiteBuilding): void {
    this.set({ buildings: [...this.state.buildings, b] })
  }

  requestFit(): void {
    this.set({ fitNonce: this.state.fitNonce + 1 })
  }

  /** Попросить холст показать объект целиком (выбор в списке объектов). */
  requestFocus(points: Pt[]): void {
    if (points.length === 0) return
    this.set({ focusReq: { points, nonce: (this.state.focusReq?.nonce ?? 0) + 1 } })
  }

  // ── Вид ────────────────────────────────────────────────────────────────────────────

  toPlan(px: number, py: number): Pt {
    const { scale, ox, oy } = this.state.view
    return { x: (px - ox) / scale, y: -(py - oy) / scale }
  }

  zoomAt(px: number, py: number, factor: number): void {
    this.stopFlight()
    const { scale, ox, oy } = this.state.view
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor))
    const k = next / scale
    this.set({ view: { scale: next, ox: px - (px - ox) * k, oy: py - (py - oy) * k } })
  }

  pan(dx: number, dy: number): void {
    this.stopFlight()
    const v = this.state.view
    this.set({ view: { ...v, ox: v.ox + dx, oy: v.oy + dy } })
  }

  /** Вписать территорию и корпуса в холст. */
  fit(width: number, height: number, points: Pt[]): void {
    this.stopFlight()
    if (points.length === 0) {
      this.set({ view: { scale: 0.005, ox: width / 2, oy: height / 2 } })
      return
    }
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    const [minX, maxX, minY, maxY] = [
      Math.min(...xs),
      Math.max(...xs),
      Math.min(...ys),
      Math.max(...ys),
    ]
    const pad = 48
    const s = Math.min(
      (width - pad * 2) / Math.max(1, maxX - minX),
      (height - pad * 2) / Math.max(1, maxY - minY),
    )
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
    this.set({
      view: {
        scale,
        ox: (width - (maxX - minX) * scale) / 2 - minX * scale,
        oy: (height + (maxY - minY) * scale) / 2 + minY * scale,
      },
    })
  }

  /**
   * Подвести вид к объекту: его рамка целиком (с отступом) в свободной части холста — не под
   * панелью инструментов. Перелётом: центр едет, масштаб меняется по логарифму — так глаз
   * не теряет, откуда и куда сдвинулась карта. Сдвиг или масштаб рукой перелёт прерывают.
   */
  focus(width: number, height: number, points: Pt[], insets: ViewInsets): void {
    if (points.length === 0 || width <= 0 || height <= 0) return
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    const [minX, maxX, minY, maxY] = [
      Math.min(...xs),
      Math.max(...xs),
      Math.min(...ys),
      Math.max(...ys),
    ]
    const aw = Math.max(1, width - insets.left - insets.right - FOCUS_PAD * 2)
    const ah = Math.max(1, height - insets.top - insets.bottom - FOCUS_PAD * 2)
    const scale = Math.min(
      MAX_SCALE,
      Math.max(
        MIN_SCALE,
        Math.min(
          aw / Math.max(MIN_FOCUS_MM, maxX - minX),
          ah / Math.max(MIN_FOCUS_MM, maxY - minY),
        ),
      ),
    )
    // Центр свободной области на экране и центр объекта на плане.
    const sx = insets.left + (width - insets.left - insets.right) / 2
    const sy = insets.top + (height - insets.top - insets.bottom) / 2
    const to = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
    const viewAt = (p: Pt, k: number) => ({ scale: k, ox: sx - p.x * k, oy: sy + p.y * k })

    this.stopFlight()
    if (prefersReducedMotion()) {
      this.set({ view: viewAt(to, scale) })
      return
    }
    const from = this.toPlan(sx, sy)
    const s0 = this.state.view.scale
    const start = performance.now()
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / FLIGHT_MS)
      const e = 1 - Math.pow(1 - t, 4)
      const k = s0 * Math.pow(scale / s0, e)
      this.set({
        view: viewAt({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e }, k),
      })
      this.flight = t < 1 ? requestAnimationFrame(step) : 0
    }
    this.flight = requestAnimationFrame(step)
  }

  private flight = 0

  private stopFlight(): void {
    if (this.flight) cancelAnimationFrame(this.flight)
    this.flight = 0
  }
}

export function useSite<T>(store: SiteStore, selector: (s: SiteState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  )
}
