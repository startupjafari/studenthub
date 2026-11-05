'use client'

import { useSyncExternalStore } from 'react'
import type { BuildingTransform, Pt, SiteFeature, SitePlanDoc } from '@studenthub/campus-core'

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
}

const HISTORY_LIMIT = 100

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

  // ── Вид ────────────────────────────────────────────────────────────────────────────

  toPlan(px: number, py: number): Pt {
    const { scale, ox, oy } = this.state.view
    return { x: (px - ox) / scale, y: -(py - oy) / scale }
  }

  zoomAt(px: number, py: number, factor: number): void {
    const { scale, ox, oy } = this.state.view
    const next = Math.min(0.5, Math.max(0.0002, scale * factor))
    const k = next / scale
    this.set({ view: { scale: next, ox: px - (px - ox) * k, oy: py - (py - oy) * k } })
  }

  pan(dx: number, dy: number): void {
    const v = this.state.view
    this.set({ view: { ...v, ox: v.ox + dx, oy: v.oy + dy } })
  }

  /** Вписать территорию и корпуса в холст. */
  fit(width: number, height: number, points: Pt[]): void {
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
    const scale = Math.min(0.5, Math.max(0.0002, s))
    this.set({
      view: {
        scale,
        ox: (width - (maxX - minX) * scale) / 2 - minX * scale,
        oy: (height + (maxY - minY) * scale) / 2 + minY * scale,
      },
    })
  }
}

export function useSite<T>(store: SiteStore, selector: (s: SiteState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  )
}
