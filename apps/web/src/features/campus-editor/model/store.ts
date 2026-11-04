'use client'

import { useSyncExternalStore } from 'react'
import {
  buildFaces,
  matchSpaces,
  randomIds,
  type EditResult,
  type Face,
  type FloorPlanDoc,
  type IdGen,
  type Problem,
  type Pt,
} from '@studenthub/campus-core'

/**
 * Состояние редактора этажа (docs/CAMPUS_BUILDER.md §12.1). Класс вне React: холст рисуется
 * по подписке без ререндеров, панели берут срезы через `useEditor(selector)`. Документ
 * неизменяемый — каждая правка даёт новый объект со структурным разделением, поэтому история
 * хранит пары ссылок «до/после», а не копии.
 */
export type ToolId =
  | 'select'
  | 'wall'
  | 'room'
  | 'door'
  | 'window'
  | 'stairs'
  | 'elevator'
  | 'label'
  | 'measure'
  | 'pan'

export type Selection =
  | { kind: 'none' }
  | { kind: 'node'; id: string }
  | { kind: 'wall'; id: string }
  | { kind: 'opening'; id: string }
  | { kind: 'space'; id: string }
  | { kind: 'face'; id: string }
  | { kind: 'vertical'; id: string }
  | { kind: 'label'; id: string }

export type SaveState = 'saved' | 'dirty' | 'saving' | 'offline' | 'conflict' | 'readonly'

export interface ViewState {
  /** Пикселей на миллиметр. */
  scale: number
  /** Смещение начала координат плана в пикселях холста. */
  ox: number
  oy: number
}

/** Временная геометрия инструмента: призрак стены, двери, рамки — не часть документа. */
export interface Preview {
  wall?: { a: Pt; b: Pt; snap: string | null }
  rect?: { a: Pt; b: Pt }
  opening?: { wallId: string; offsetMm: number; widthMm: number; type: 'door' | 'window' }
  drag?: { nodeId: string; to: Pt }
  measure?: { a: Pt; b: Pt }
  cursor?: Pt
}

export interface EditorState {
  doc: FloorPlanDoc
  /** Ревизия сервера, от которой идёт правка (оптимистичная конкуренция). */
  revision: number
  faces: Face[]
  /** Грань → помещение (из сопоставления после правки). */
  faceSpace: Record<string, string>
  problems: Problem[]
  selection: Selection
  tool: ToolId
  view: ViewState
  preview: Preview
  saveState: SaveState
  canUndo: boolean
  canRedo: boolean
  /** Метка шага для подсказки «Отменить: …». */
  undoLabel: string | null
  floorHeightMm: number
}

interface HistoryEntry {
  before: FloorPlanDoc
  after: FloorPlanDoc
  label: string
  key: string | null
  at: number
}

const HISTORY_LIMIT = 200
const MERGE_MS = 800

export class EditorStore {
  private state: EditorState
  private readonly listeners = new Set<() => void>()
  private past: HistoryEntry[] = []
  private future: HistoryEntry[] = []
  readonly ids: IdGen = randomIds
  /** Вызывается после каждой правки документа (автосохранение, проверка). */
  onDocChange: ((doc: FloorPlanDoc) => void) | null = null

  constructor(doc: FloorPlanDoc, revision: number, floorHeightMm: number) {
    const faces = buildFaces(doc).faces
    const matched = matchSpaces(doc, {}, faces)
    this.state = {
      doc,
      revision,
      faces,
      faceSpace: invert(matched.assignments),
      problems: [],
      selection: { kind: 'none' },
      tool: 'select',
      view: { scale: 0.05, ox: 40, oy: 40 },
      preview: {},
      saveState: 'saved',
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      floorHeightMm,
    }
  }

  getState = (): EditorState => this.state

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  set(patch: Partial<EditorState>): void {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }

  /**
   * Правка документа одной командой. Операция возвращает новый документ и происхождение стен;
   * помещения тут же сопоставляются с новыми гранями (§11.5), шаг уходит в историю. Шаги с
   * одним `mergeKey` в пределах 800 мс сливаются: перетаскивание — один шаг, а не сотня.
   */
  apply(
    label: string,
    op: (doc: FloorPlanDoc) => EditResult | FloorPlanDoc,
    mergeKey: string | null = null,
  ): void {
    if (this.state.saveState === 'readonly') return
    const before = this.state.doc
    const result = op(before)
    const edit: EditResult =
      'doc' in result && 'lineage' in result
        ? result
        : { doc: result as FloorPlanDoc, lineage: {}, created: [] }
    if (edit.doc === before) return
    const faces = buildFaces(edit.doc).faces
    const matched = matchSpaces(edit.doc, edit.lineage, faces)
    const after = matched.doc
    const now = Date.now()
    const last = this.past.at(-1)
    if (last && mergeKey && last.key === mergeKey && now - last.at < MERGE_MS) {
      last.after = after
      last.at = now
    } else {
      this.past.push({ before, after, label, key: mergeKey, at: now })
      if (this.past.length > HISTORY_LIMIT) this.past.shift()
    }
    this.future = []
    this.commit(after, faces, matched.assignments, { saveState: 'dirty' })
  }

  undo(): void {
    const entry = this.past.pop()
    if (!entry || this.state.saveState === 'readonly') return
    this.future.push(entry)
    this.restore(entry.before)
  }

  redo(): void {
    const entry = this.future.pop()
    if (!entry || this.state.saveState === 'readonly') return
    this.past.push(entry)
    this.restore(entry.after)
  }

  /** Документ с сервера (загрузка, «загрузить актуальную» при конфликте) — история с нуля. */
  replace(doc: FloorPlanDoc, revision: number): void {
    this.past = []
    this.future = []
    const faces = buildFaces(doc).faces
    const matched = matchSpaces(doc, {}, faces)
    this.commit(matched.doc, faces, matched.assignments, {
      revision,
      saveState: 'saved',
      selection: { kind: 'none' },
    })
  }

  private restore(doc: FloorPlanDoc): void {
    const faces = buildFaces(doc).faces
    const matched = matchSpaces(doc, {}, faces)
    this.commit(doc, faces, matched.assignments, {
      saveState: 'dirty',
      selection: { kind: 'none' },
    })
  }

  private commit(
    doc: FloorPlanDoc,
    faces: Face[],
    assignments: Record<string, string>,
    patch: Partial<EditorState>,
  ): void {
    this.set({
      doc,
      faces,
      faceSpace: invert(assignments),
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      undoLabel: this.past.at(-1)?.label ?? null,
      ...patch,
    })
    this.onDocChange?.(doc)
  }

  // ── Вид: перевод координат холст ↔ план ──────────────────────────────────────────

  /** Точка холста (px) → точка плана (мм). Ось Y плана — вверх, холста — вниз. */
  toPlan(px: number, py: number): Pt {
    const { scale, ox, oy } = this.state.view
    return { x: (px - ox) / scale, y: -(py - oy) / scale }
  }

  toScreen(p: Pt): { x: number; y: number } {
    const { scale, ox, oy } = this.state.view
    return { x: ox + p.x * scale, y: oy - p.y * scale }
  }

  /** Масштаб к точке экрана (колесо, щипок): точка под курсором остаётся на месте. */
  zoomAt(px: number, py: number, factor: number): void {
    const { scale, ox, oy } = this.state.view
    const next = Math.min(2, Math.max(0.002, scale * factor))
    const k = next / scale
    this.set({ view: { scale: next, ox: px - (px - ox) * k, oy: py - (py - oy) * k } })
  }

  pan(dx: number, dy: number): void {
    const v = this.state.view
    this.set({ view: { ...v, ox: v.ox + dx, oy: v.oy + dy } })
  }

  /** Вписать план в холст с полями. */
  fit(width: number, height: number): void {
    const pts = Object.values(this.state.doc.nodes)
    if (pts.length === 0) return
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const pad = 48
    const scale = Math.min(
      (width - pad * 2) / Math.max(1, maxX - minX),
      (height - pad * 2) / Math.max(1, maxY - minY),
    )
    const s = Math.min(1, Math.max(0.002, scale))
    this.set({
      view: {
        scale: s,
        ox: (width - (maxX - minX) * s) / 2 - minX * s,
        oy: (height + (maxY - minY) * s) / 2 + minY * s,
      },
    })
  }
}

function invert(assignments: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [spaceId, faceId] of Object.entries(assignments)) out[faceId] = spaceId
  return out
}

/** Срез состояния редактора для React-компонента. */
export function useEditor<T>(store: EditorStore, selector: (s: EditorState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  )
}
