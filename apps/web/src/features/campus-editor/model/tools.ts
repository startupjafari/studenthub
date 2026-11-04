import {
  addRoomRect,
  addWall,
  interiorPoint,
  moveNode,
  projectOnSegment,
  removeWall,
  ACADEMIC_SPACE_KINDS,
  HIDDEN_BY_DEFAULT_KINDS,
  type EditResult,
  type FloorPlanDoc,
  type PlanWall,
  type Pt,
  type SpaceKind,
} from '@studenthub/campus-core'
import { hitTest, hitWall, snapPoint, wallPoints } from '../lib/hit'
import { gridStep } from '../lib/draw'
import type { EditorStore, Selection } from './store'

/**
 * Инструменты редактора (§12.4–12.10): конечные автоматы поверх событий указателя. Холст
 * переводит событие в точку плана и зовёт `down/move/up`; инструмент пишет призрак в
 * `preview`, а в документ — одной командой `store.apply` по завершении жеста.
 */
export interface PointerInput {
  plan: Pt
  shift: boolean
  alt: boolean
  /** Радиус попадания в мм: 8 px мышью, 22 px пальцем и пером (ручки 44 px, §12.11). */
  radiusMm: number
  double?: boolean
}

export interface ToolSettings {
  wallThicknessMm: number
  wallKind: PlanWall['kind']
  doorWidthMm: number
  windowWidthMm: number
  spaceKind: SpaceKind
}

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  wallThicknessMm: 200,
  wallKind: 'wall',
  doorWidthMm: 900,
  windowWidthMm: 1500,
  spaceKind: 'auditorium',
}

/** Меньше — промах, а не комната (0,5 м по стороне). */
const MIN_RECT_MM = 500

type Gesture =
  | { kind: 'idle' }
  | { kind: 'chain'; from: Pt }
  | { kind: 'rect'; from: Pt }
  | { kind: 'drag-node'; nodeId: string; from: Pt; moved: boolean }
  | { kind: 'drag-opening'; openingId: string; grab: number; moved: boolean }
  | { kind: 'drag-label'; labelId: string; space: boolean; moved: boolean }
  | { kind: 'measure'; from: Pt }

export class ToolController {
  private gesture: Gesture = { kind: 'idle' }
  settings: ToolSettings = { ...DEFAULT_TOOL_SETTINGS }

  /** `viewOnly` — просмотр карты: клик выбирает помещение, ничего не перетаскивается. */
  constructor(
    private readonly store: EditorStore,
    private readonly viewOnly = false,
  ) {}

  private get s() {
    return this.store.getState()
  }

  private grid(): number {
    // Сетка привязки мельче видимой: при крупном масштабе — 50 мм, при мелком — по сетке.
    return Math.max(50, gridStep(this.s.view.scale) / 2)
  }

  private snap(input: PointerInput, from: Pt | null) {
    return snapPoint(this.s.doc, input.plan, input.radiusMm, this.grid(), from, {
      free: input.alt,
      angleStep: input.shift,
    })
  }

  /** Сбросить незавершённый жест (смена инструмента, Escape). */
  cancel(): void {
    this.gesture = { kind: 'idle' }
    this.store.set({ preview: {} })
  }

  down(input: PointerInput): void {
    const tool = this.s.tool
    if (tool === 'select') return this.selectDown(input)
    if (tool === 'wall') return this.wallClick(input)
    if (tool === 'room' || tool === 'stairs' || tool === 'elevator') {
      const p = this.snap(input, null).point
      this.gesture = { kind: 'rect', from: p }
      this.store.set({ preview: { rect: { a: p, b: p } } })
      return
    }
    if (tool === 'door' || tool === 'window') return this.placeOpening(input)
    if (tool === 'label') return this.placeLabel(input)
    if (tool === 'measure') {
      const p = this.snap(input, null).point
      this.gesture = { kind: 'measure', from: p }
      this.store.set({ preview: { measure: { a: p, b: p } } })
    }
  }

  move(input: PointerInput): void {
    const g = this.gesture
    const tool = this.s.tool
    if (g.kind === 'chain') {
      const snap = this.snap(input, g.from)
      this.store.set({ preview: { wall: { a: g.from, b: snap.point, snap: snap.kind } } })
      return
    }
    if (g.kind === 'rect') {
      this.store.set({ preview: { rect: { a: g.from, b: this.snap(input, null).point } } })
      return
    }
    if (g.kind === 'measure') {
      this.store.set({ preview: { measure: { a: g.from, b: this.snap(input, g.from).point } } })
      return
    }
    if (g.kind === 'drag-node') {
      const to = snapPoint(this.s.doc, input.plan, input.radiusMm, this.grid(), null, {
        free: input.alt,
      })
      // Сам узел не цель привязки: иначе он «прилипает» к своему же месту.
      const point = to.nodeId === g.nodeId ? roundPt(input.plan) : to.point
      this.gesture = { ...g, moved: true }
      this.store.set({ preview: { drag: { nodeId: g.nodeId, to: point } } })
      return
    }
    if (g.kind === 'drag-opening') {
      const o = this.s.doc.openings[g.openingId]
      const pts = o?.wallId ? wallPoints(this.s.doc, o.wallId) : null
      if (!o || !pts) return
      const len = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
      const t = projectOnSegment(input.plan, pts[0], pts[1]).t
      const offsetMm = clamp(Math.round(t * len - g.grab), 0, Math.max(0, len - o.widthMm))
      this.gesture = { ...g, moved: true }
      this.store.set({
        preview: { opening: { wallId: o.wallId!, offsetMm, widthMm: o.widthMm, type: o.type } },
      })
      return
    }
    if (g.kind === 'drag-label') {
      this.gesture = { ...g, moved: true }
      this.store.set({ preview: { cursor: roundPt(input.plan) } })
      return
    }
    // Без жеста — призраки наведения.
    if (tool === 'wall') {
      const snap = this.snap(input, null)
      this.store.set({ preview: { cursor: snap.point } })
    } else if (tool === 'door' || tool === 'window') {
      const ghost = this.openingAt(input, tool)
      this.store.set({ preview: ghost ? { opening: ghost } : { cursor: roundPt(input.plan) } })
    } else if (this.s.preview.cursor || this.s.preview.opening) {
      this.store.set({ preview: {} })
    }
  }

  up(input: PointerInput): void {
    const g = this.gesture
    if (g.kind === 'rect') {
      const b = this.snap(input, null).point
      this.gesture = { kind: 'idle' }
      this.store.set({ preview: {} })
      this.commitRect(g.from, b)
      return
    }
    if (g.kind === 'measure') {
      // Линейка остаётся на экране до следующего жеста.
      this.gesture = { kind: 'idle' }
      return
    }
    if (g.kind === 'drag-node') {
      const to = this.s.preview.drag?.to
      this.gesture = { kind: 'idle' }
      this.store.set({ preview: {} })
      if (g.moved && to) {
        this.store.apply('moveNode', (doc) => moveNode(doc, g.nodeId, to, this.store.ids))
        // Узел мог слиться с соседним — выделение на нём уже не держится.
        if (!this.s.doc.nodes[g.nodeId]) this.store.set({ selection: { kind: 'none' } })
      }
      return
    }
    if (g.kind === 'drag-opening') {
      const pv = this.s.preview.opening
      this.gesture = { kind: 'idle' }
      this.store.set({ preview: {} })
      if (g.moved && pv) {
        this.store.apply('moveOpening', (doc) => {
          const o = doc.openings[g.openingId]
          if (!o) return doc
          return {
            ...doc,
            openings: { ...doc.openings, [g.openingId]: { ...o, offsetMm: pv.offsetMm } },
          }
        })
      }
      return
    }
    if (g.kind === 'drag-label') {
      const to = this.s.preview.cursor
      this.gesture = { kind: 'idle' }
      this.store.set({ preview: {} })
      if (g.moved && to) {
        this.store.apply('moveLabel', (doc) =>
          g.space
            ? (() => {
                const sp = doc.spaces[g.labelId]
                return sp
                  ? { ...doc, spaces: { ...doc.spaces, [g.labelId]: { ...sp, label: to } } }
                  : doc
              })()
            : (() => {
                const l = doc.labels[g.labelId]
                return l
                  ? { ...doc, labels: { ...doc.labels, [g.labelId]: { ...l, x: to.x, y: to.y } } }
                  : doc
              })(),
        )
      }
    }
  }

  /** Двойной клик: в стене — закончить цепочку, на пустой грани — создать помещение. */
  doubleClick(input: PointerInput): void {
    if (this.viewOnly) return
    if (this.s.tool === 'wall') {
      this.cancel()
      return
    }
    if (this.s.tool === 'select') {
      const hit = hitTest(this.s.doc, this.s.faces, this.s.faceSpace, input.plan, input.radiusMm)
      if (hit.kind === 'face') this.createSpace(hit.id)
    }
  }

  // ── Выделение и перетаскивание ─────────────────────────────────────────────────────

  private selectDown(input: PointerInput): void {
    const s = this.s
    if (this.viewOnly) {
      // Зрителю стены и узлы не нужны: выбор — только помещения под курсором.
      const hit = hitTest(s.doc, s.faces, s.faceSpace, input.plan, 0)
      this.store.set({ selection: hit.kind === 'space' ? hit : { kind: 'none' } })
      return
    }
    const hit = hitTest(s.doc, s.faces, s.faceSpace, input.plan, input.radiusMm)
    // Подпись помещения тянется за метку: попадание рядом с ней важнее грани.
    if (hit.kind === 'space' || hit.kind === 'face' || hit.kind === 'none') {
      for (const [id, sp] of Object.entries(s.doc.spaces)) {
        if (
          Math.hypot(sp.label.x - input.plan.x, sp.label.y - input.plan.y) <=
          input.radiusMm * 1.5
        ) {
          this.store.set({ selection: { kind: 'space', id } })
          this.gesture = { kind: 'drag-label', labelId: id, space: true, moved: false }
          return
        }
      }
    }
    this.store.set({ selection: hit })
    if (hit.kind === 'node') {
      this.gesture = { kind: 'drag-node', nodeId: hit.id, from: s.doc.nodes[hit.id]!, moved: false }
    } else if (hit.kind === 'opening') {
      const o = s.doc.openings[hit.id]!
      const pts = wallPoints(s.doc, o.wallId!)!
      const len = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
      const grab = projectOnSegment(input.plan, pts[0], pts[1]).t * len - o.offsetMm
      this.gesture = { kind: 'drag-opening', openingId: hit.id, grab, moved: false }
    } else if (hit.kind === 'label') {
      this.gesture = { kind: 'drag-label', labelId: hit.id, space: false, moved: false }
    }
  }

  // ── Стены ──────────────────────────────────────────────────────────────────────────

  private wallClick(input: PointerInput): void {
    const g = this.gesture
    const from = g.kind === 'chain' ? g.from : null
    const snap = this.snap(input, from)
    if (!from) {
      this.gesture = { kind: 'chain', from: snap.point }
      this.store.set({ preview: { wall: { a: snap.point, b: snap.point, snap: snap.kind } } })
      return
    }
    if (snap.point.x === from.x && snap.point.y === from.y) {
      // Второй клик в ту же точку — конец цепочки.
      this.cancel()
      return
    }
    const spec = {
      thicknessMm: this.settings.wallKind === 'glass' ? 100 : this.settings.wallThicknessMm,
      kind: this.settings.wallKind,
    }
    this.store.apply('addWall', (doc) => addWall(doc, from, snap.point, spec, this.store.ids))
    // Замкнули контур на существующий узел — цепочка закончена, иначе продолжается.
    if (snap.kind === 'node' && input.double !== false && this.closesLoop(snap.point)) {
      this.cancel()
      return
    }
    this.gesture = { kind: 'chain', from: snap.point }
    this.store.set({ preview: { wall: { a: snap.point, b: snap.point, snap: null } } })
  }

  /** Узел уже был частью графа до этой цепочки — значит, контур замкнут. */
  private closesLoop(p: Pt): boolean {
    const doc = this.s.doc
    const id = Object.entries(doc.nodes).find(([, n]) => n.x === p.x && n.y === p.y)?.[0]
    if (!id) return false
    return Object.values(doc.walls).filter((w) => w.a === id || w.b === id).length > 1
  }

  // ── Прямоугольники: комната, лестница, лифт ───────────────────────────────────────

  private commitRect(a: Pt, b: Pt): void {
    const x = Math.min(a.x, b.x)
    const y = Math.min(a.y, b.y)
    const w = Math.abs(b.x - a.x)
    const h = Math.abs(b.y - a.y)
    if (w < MIN_RECT_MM || h < MIN_RECT_MM) return
    const tool = this.s.tool
    if (tool === 'room') {
      const spec = { thicknessMm: this.settings.wallThicknessMm, kind: this.settings.wallKind }
      const before = new Set(Object.keys(this.s.doc.spaces))
      this.store.apply('addRoom', (doc) => {
        const r = addRoomRect(doc, x, y, w, h, spec, this.store.ids)
        return withSpaceAt(
          r,
          { x: Math.round(x + w / 2), y: Math.round(y + h / 2) },
          this.settings.spaceKind,
          this.store.ids('s'),
        )
      })
      const created = Object.keys(this.s.doc.spaces).find((id) => !before.has(id))
      if (created) this.store.set({ selection: { kind: 'space', id: created } })
      return
    }
    if (tool === 'stairs' || tool === 'elevator') {
      const id = this.store.ids('v')
      this.store.apply(tool === 'stairs' ? 'addStairs' : 'addElevator', (doc) => ({
        ...doc,
        verticals: {
          ...doc.verticals,
          [id]: {
            type: tool,
            // Своя группа; связать с лестницей другого этажа — в свойствах.
            groupId: `g_${id.slice(2)}`,
            outline: [
              [x, y],
              [x + w, y],
              [x + w, y + h],
              [x, y + h],
            ],
            stepFree: tool === 'elevator',
            landing: { x: Math.round(x + w / 2), y },
          },
        },
      }))
      this.store.set({ selection: { kind: 'vertical', id } })
    }
  }

  // ── Проёмы ─────────────────────────────────────────────────────────────────────────

  private openingAt(input: PointerInput, type: 'door' | 'window') {
    const hit = hitWall(this.s.doc, input.plan, input.radiusMm * 2)
    if (!hit) return null
    const w = this.s.doc.walls[hit.wallId]
    if (!w || w.kind === 'virtual') return null
    const pts = wallPoints(this.s.doc, hit.wallId)!
    const len = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
    const width = type === 'door' ? this.settings.doorWidthMm : this.settings.windowWidthMm
    if (len < width + 100) return null
    const offsetMm = clamp(Math.round(hit.t * len - width / 2), 50, Math.round(len - width - 50))
    return { wallId: hit.wallId, offsetMm, widthMm: width, type }
  }

  private placeOpening(input: PointerInput): void {
    const tool = this.s.tool
    if (tool !== 'door' && tool !== 'window') return
    const at = this.openingAt(input, tool)
    if (!at) return
    const id = this.store.ids('o')
    this.store.apply(tool === 'door' ? 'addDoor' : 'addWindow', (doc) => ({
      ...doc,
      openings: {
        ...doc.openings,
        [id]:
          tool === 'door'
            ? {
                type: 'door',
                wallId: at.wallId,
                offsetMm: at.offsetMm,
                widthMm: at.widthMm,
                heightMm: 2100,
                swing: 'left-in',
                access: 'public',
              }
            : {
                type: 'window',
                wallId: at.wallId,
                offsetMm: at.offsetMm,
                widthMm: at.widthMm,
                heightMm: 1500,
                sillMm: 900,
              },
      },
    }))
    this.store.set({ selection: { kind: 'opening', id }, preview: {} })
  }

  private placeLabel(input: PointerInput): void {
    const id = this.store.ids('t')
    const p = roundPt(input.plan)
    this.store.apply('addLabel', (doc) => ({
      ...doc,
      labels: { ...doc.labels, [id]: { x: p.x, y: p.y, text: '…' } },
    }))
    this.store.set({ selection: { kind: 'label', id }, tool: 'select' })
  }

  // ── Команды панели свойств ──────────────────────────────────────────────────────────

  /** Помещение на пустой грани: тип по умолчанию из настроек инструмента. */
  createSpace(faceId: string): void {
    const face = this.s.faces.find((f) => f.id === faceId)
    if (!face) return
    const label = interiorPoint(
      face.outer.points,
      face.holes.map((h) => h.points),
    )
    if (!label) return
    const id = this.store.ids('s')
    const kind = this.settings.spaceKind
    this.store.apply('addSpace', (doc) => ({
      ...doc,
      spaces: {
        ...doc.spaces,
        [id]: {
          label,
          edges: face.outer.wallIds,
          kind,
          visibility: HIDDEN_BY_DEFAULT_KINDS.includes(kind) ? 'hidden' : 'public',
        },
      },
    }))
    this.store.set({ selection: { kind: 'space', id } })
  }

  /**
   * Сдвиг выделенного стрелками (§16.3, доступность без мыши): узел, надпись, подпись
   * помещения, лестница или лифт — на вектор; проём — вдоль своей стены.
   */
  nudge(dx: number, dy: number): void {
    const sel = this.s.selection
    const doc = this.s.doc
    const key = `nudge:${sel.kind}:${'id' in sel ? sel.id : ''}`
    if (sel.kind === 'node') {
      const n = doc.nodes[sel.id]
      if (n)
        this.store.apply(
          'moveNode',
          (d) => moveNode(d, sel.id, { x: n.x + dx, y: n.y + dy }, this.store.ids),
          key,
        )
    } else if (sel.kind === 'label') {
      this.store.apply(
        'moveLabel',
        (d) => {
          const l = d.labels[sel.id]
          return l
            ? { ...d, labels: { ...d.labels, [sel.id]: { ...l, x: l.x + dx, y: l.y + dy } } }
            : d
        },
        key,
      )
    } else if (sel.kind === 'space') {
      this.store.apply(
        'moveLabel',
        (d) => {
          const sp = d.spaces[sel.id]
          return sp
            ? {
                ...d,
                spaces: {
                  ...d.spaces,
                  [sel.id]: { ...sp, label: { x: sp.label.x + dx, y: sp.label.y + dy } },
                },
              }
            : d
        },
        key,
      )
    } else if (sel.kind === 'vertical') {
      this.store.apply(
        'moveVertical',
        (d) => {
          const v = d.verticals[sel.id]
          if (!v) return d
          return {
            ...d,
            verticals: {
              ...d.verticals,
              [sel.id]: {
                ...v,
                outline: v.outline.map(([x, y]) => [x + dx, y + dy] as [number, number]),
                landing: { x: v.landing.x + dx, y: v.landing.y + dy },
              },
            },
          }
        },
        key,
      )
    } else if (sel.kind === 'opening') {
      const o = doc.openings[sel.id]
      const pts = o?.wallId ? wallPoints(doc, o.wallId) : null
      if (!o || !pts) return
      const len = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1
      // Проекция вектора на ось стены: «вправо» по стене, куда бы она ни смотрела.
      const along = ((pts[1].x - pts[0].x) * dx + (pts[1].y - pts[0].y) * dy) / len
      const offsetMm = clamp(
        Math.round(o.offsetMm + along),
        0,
        Math.max(0, Math.round(len - o.widthMm)),
      )
      this.store.apply(
        'moveOpening',
        (d) => ({ ...d, openings: { ...d.openings, [sel.id]: { ...o, offsetMm } } }),
        key,
      )
    }
  }

  /** Точный перенос узла из панели свойств. */
  moveNodeTo(nodeId: string, to: Pt): void {
    this.store.apply('moveNode', (doc) => moveNode(doc, nodeId, roundPt(to), this.store.ids))
    if (!this.s.doc.nodes[nodeId]) this.store.set({ selection: { kind: 'none' } })
  }

  /** Удалить выделенное (Delete / Backspace). */
  deleteSelection(): void {
    const sel = this.s.selection
    const label = 'delete'
    const drop = <T>(record: Record<string, T>, id: string): Record<string, T> => {
      const { [id]: _, ...rest } = record
      return rest
    }
    switch (sel.kind) {
      case 'wall':
        this.store.apply(label, (doc) => removeWall(doc, sel.id, this.store.ids))
        break
      case 'node':
        this.store.apply(label, (doc) => removeNode(doc, sel.id))
        break
      case 'opening':
        this.store.apply(label, (doc) => ({ ...doc, openings: drop(doc.openings, sel.id) }))
        break
      case 'space':
        this.store.apply(label, (doc) => ({ ...doc, spaces: drop(doc.spaces, sel.id) }))
        break
      case 'vertical':
        this.store.apply(label, (doc) => ({ ...doc, verticals: drop(doc.verticals, sel.id) }))
        break
      case 'label':
        this.store.apply(label, (doc) => ({ ...doc, labels: drop(doc.labels, sel.id) }))
        break
      default:
        return
    }
    this.store.set({ selection: { kind: 'none' } as Selection })
  }
}

/** Узел со всеми его стенами: стены по одной, чтобы проёмы честно припарковались. */
function removeNode(doc: FloorPlanDoc, nodeId: string): EditResult {
  let cur: EditResult = { doc, lineage: {}, created: [] }
  for (const [wid, w] of Object.entries(doc.walls)) {
    if (w.a === nodeId || w.b === nodeId)
      cur = { ...removeWall(cur.doc, wid), lineage: cur.lineage, created: [] }
  }
  return cur
}

/** Помещение в грани, где лежит точка (новая комната из шаблона сразу размечена). */
function withSpaceAt(r: EditResult, at: Pt, kind: SpaceKind, id: string): EditResult {
  return {
    ...r,
    doc: {
      ...r.doc,
      spaces: {
        ...r.doc.spaces,
        [id]: {
          label: at,
          // Рёбра подберёт сопоставление по метке: грань ещё не посчитана.
          edges: [],
          kind,
          visibility: HIDDEN_BY_DEFAULT_KINDS.includes(kind) ? 'hidden' : 'public',
        },
      },
    },
  }
}

export function isAcademic(kind: SpaceKind): boolean {
  return ACADEMIC_SPACE_KINDS.includes(kind)
}

function roundPt(p: Pt): Pt {
  return { x: Math.round(p.x), y: Math.round(p.y) }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
