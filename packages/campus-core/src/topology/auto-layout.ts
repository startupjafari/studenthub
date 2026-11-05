import type {
  FloorPlanDoc,
  PlanOpening,
  PlanSpace,
  PlanVertical,
  SpaceKind,
} from '../format/schema.js'
import { HIDDEN_BY_DEFAULT_KINDS } from '../format/schema.js'
import { randomIds, type IdGen } from '../format/ids.js'
import type { Pt } from '../geom/int.js'
import { pointInPolygon } from '../geom/polygon.js'
import { projectOnSegment } from '../geom/project.js'
import { floorFromOutline, normalizeOutline } from './building.js'
import { addWall, removeWall, type WallSpec } from './edit.js'
import { buildFaces, faceContains } from './faces.js'
import { matchSpaces } from './match-spaces.js'

/**
 * «Автопланировка»: этаж по контуру корпуса одним действием — коридоры, кабинеты по обе
 * стороны, лестницы и туалеты в торцах, лифтовой холл, двери в коридор и окна. Так новый
 * корпус получает рабочую схему сразу, а человек правит только то, что отличается.
 *
 * Контур с прямыми углами (все стороны по осям корпуса) режется на прямоугольные крылья —
 * жадно, самыми большими первыми: у «Г», «П», «Т» и любых ступенчатых форм это и есть их
 * крылья. В крыле коридор идёт по длинной оси: широкое — кабинеты по обе стороны, среднее —
 * по одной, узкое целиком становится холлом. Коридоры соседних крыльев соединяются проходом
 * через ряд кабинетов.
 */
export interface AutoLayoutOptions {
  /** Уровень этажа: из него номера кабинетов («2» → 201, 202…). */
  level: number
  corridorMm?: number
  /** Шаг кабинетов вдоль коридора. */
  roomWidthMm?: number
  /** Назначение обычных кабинетов. */
  roomKind?: SpaceKind
  /** Лифтов в лифтовом холле; 0 — без лифтов. */
  lifts?: number
  /** Вход с улицы в торце коридора; по умолчанию — на 1 этаже. */
  entrance?: boolean
  /** Окна на наружных стенах; по умолчанию — на надземных этажах. */
  windows?: boolean
  partition?: WallSpec
}

export type AutoLayoutError = 'NOT_ORTHOGONAL' | 'TOO_SMALL'

export type AutoLayoutResult = { doc: FloorPlanDoc } | { error: AutoLayoutError }

interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

type CellKind = SpaceKind | 'room'

interface Cell extends Rect {
  kind: CellKind
  lifts?: number
}

interface Special {
  a: number
  b: number
  kind: CellKind
  lifts?: number
  /** Больше — важнее: при наложении остаётся спецячейка с большим приоритетом. */
  priority: number
}

interface Row {
  /** Поперёк крыла: от d0 до d1. */
  d0: number
  d1: number
  specials: Special[]
}

interface Wing {
  r: Rect
  axis: 'x' | 'y'
  /** Вдоль оси. */
  l0: number
  l1: number
  /** Поперёк. */
  t0: number
  t1: number
  type: 'double' | 'single' | 'hall'
  /** Коридор поперёк: c0..c1 (для холла — весь прямоугольник). */
  c0: number
  c1: number
  rows: Row[]
}

const CIRC = new Set<CellKind>(['corridor', 'hall'])
const DOOR_MM = 900
const WIDE_DOOR_MM = 1500
const STAIRS_MM = 6000
const LIFT_HALL_MM = 4800
const MIN_DOUBLE_MM = 11_000
const MIN_SINGLE_MM = 6_500
const MIN_CELL_MM = 2_000

export function autoLayout(outline: readonly Pt[], options: AutoLayoutOptions): AutoLayoutResult {
  const ring = normalizeOutline(outline)
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    if (a.x !== b.x && a.y !== b.y) return { error: 'NOT_ORTHOGONAL' }
  }
  const corridor = options.corridorMm ?? 2400
  const roomW = options.roomWidthMm ?? 6000
  const rects = decompose(ring)
  if (rects.length === 0) return { error: 'TOO_SMALL' }

  const wings = rects.map((r) => makeWing(r, corridor, rects))
  connectWings(wings, rects, corridor)
  placeEnds(wings, rects)
  placeLifts(wings, options.lifts ?? 2)

  const cells: Cell[] = []
  for (const w of wings) cells.push(...wingCells(w, roomW))
  const entrance = (options.entrance ?? options.level === 1) ? entrancePoint(wings, rects) : null
  return {
    doc: buildDoc(ring, cells, {
      level: options.level,
      roomKind: options.roomKind ?? 'office',
      partition: options.partition ?? { thicknessMm: 200, kind: 'wall' },
      entrance,
      windows: options.windows ?? options.level >= 1,
      ids: randomIds,
    }),
  }
}

// ── Крылья ────────────────────────────────────────────────────────────────────────

/** Самые большие прямоугольники из клеток сетки по вершинам контура — по одному, жадно. */
function decompose(ring: Pt[]): Rect[] {
  const xs = [...new Set(ring.map((p) => p.x))].sort((a, b) => a - b)
  const ys = [...new Set(ring.map((p) => p.y))].sort((a, b) => a - b)
  const nx = xs.length - 1
  const ny = ys.length - 1
  const free: boolean[][] = []
  for (let i = 0; i < nx; i++) {
    free.push([])
    for (let j = 0; j < ny; j++) {
      const c = { x: (xs[i]! + xs[i + 1]!) / 2, y: (ys[j]! + ys[j + 1]!) / 2 }
      free[i]!.push(pointInPolygon(c, ring) === 'inside')
    }
  }
  const out: Rect[] = []
  for (;;) {
    let best: { i0: number; i1: number; j0: number; j1: number; area: number } | null = null
    for (let i0 = 0; i0 < nx; i0++) {
      for (let j0 = 0; j0 < ny; j0++) {
        if (!free[i0]![j0]) continue
        let top = ny
        for (let i1 = i0; i1 < nx && free[i1]![j0]; i1++) {
          let j = j0
          while (j < top && free[i1]![j]) j++
          top = j
          const area = (xs[i1 + 1]! - xs[i0]!) * (ys[top]! - ys[j0]!)
          if (!best || area > best.area) best = { i0, i1, j0, j1: top - 1, area }
        }
      }
    }
    if (!best) break
    for (let i = best.i0; i <= best.i1; i++)
      for (let j = best.j0; j <= best.j1; j++) free[i]![j] = false
    out.push({ x0: xs[best.i0]!, x1: xs[best.i1 + 1]!, y0: ys[best.j0]!, y1: ys[best.j1 + 1]! })
  }
  return out
}

interface Contact {
  /** Общая линия: вертикальная x = at или горизонтальная y = at. */
  line: 'x' | 'y'
  at: number
  from: number
  to: number
}

/** Общая сторона двух прямоугольников (касание по отрезку, а не в точке). */
function contact(a: Rect, b: Rect): Contact | null {
  if (a.x1 === b.x0 || a.x0 === b.x1) {
    const from = Math.max(a.y0, b.y0)
    const to = Math.min(a.y1, b.y1)
    if (to - from > 0) return { line: 'x', at: a.x1 === b.x0 ? a.x1 : a.x0, from, to }
  }
  if (a.y1 === b.y0 || a.y0 === b.y1) {
    const from = Math.max(a.x0, b.x0)
    const to = Math.min(a.x1, b.x1)
    if (to - from > 0) return { line: 'y', at: a.y1 === b.y0 ? a.y1 : a.y0, from, to }
  }
  return null
}

function makeWing(r: Rect, corridor: number, all: Rect[]): Wing {
  const axis = r.x1 - r.x0 >= r.y1 - r.y0 ? 'x' : 'y'
  const [l0, l1, t0, t1] = axis === 'x' ? [r.x0, r.x1, r.y0, r.y1] : [r.y0, r.y1, r.x0, r.x1]
  const depth = t1 - t0
  if (depth >= MIN_DOUBLE_MM) {
    const c0 = Math.round((t0 + t1) / 2 - corridor / 2)
    const c1 = c0 + corridor
    return {
      r,
      axis,
      l0,
      l1,
      t0,
      t1,
      type: 'double',
      c0,
      c1,
      rows: [
        { d0: t0, d1: c0, specials: [] },
        { d0: c1, d1: t1, specials: [] },
      ],
    }
  }
  if (depth >= MIN_SINGLE_MM) {
    // Коридор — у той длинной стороны, которой крыло примыкает к соседям: так проход к ним
    // короче, а кабинеты получают окна на улицу.
    const along = (side: number): number =>
      all.reduce((sum, o) => {
        if (o === r) return sum
        const k = contact(r, o)
        return k && k.line === (axis === 'x' ? 'y' : 'x') && k.at === side
          ? sum + k.to - k.from
          : sum
      }, 0)
    const low = along(t0) >= along(t1)
    const c0 = low ? t0 : t1 - corridor
    const c1 = c0 + corridor
    return {
      r,
      axis,
      l0,
      l1,
      t0,
      t1,
      type: 'single',
      c0,
      c1,
      rows: [low ? { d0: c1, d1: t1, specials: [] } : { d0: t0, d1: c0, specials: [] }],
    }
  }
  return { r, axis, l0, l1, t0, t1, type: 'hall', c0: t0, c1: t1, rows: [] }
}

/** Ряд крыла, прилегающий к линии поперёк `at` (сторона крыла), если он есть. */
function rowAt(w: Wing, at: number): Row | undefined {
  return w.rows.find((r) => r.d0 === at || r.d1 === at)
}

function addSpecial(row: Row | undefined, s: Special): void {
  if (row) row.specials.push(s)
}

/**
 * Проходы между крыльями. Коридор, упирающийся в соседа торцом, продолжается сквозь ряд
 * соседа до его коридора; крылья, стоящие бок о бок, соединяются проходом посередине
 * общей стороны.
 */
function connectWings(wings: Wing[], rects: Rect[], corridor: number): void {
  for (let i = 0; i < wings.length; i++) {
    for (let j = i + 1; j < wings.length; j++) {
      const k = contact(rects[i]!, rects[j]!)
      if (!k) continue
      for (const [p, q] of [
        [wings[i]!, wings[j]!],
        [wings[j]!, wings[i]!],
      ] as const) {
        const pEndsHere = p.axis === k.line && (p.l0 === k.at || p.l1 === k.at)
        const qSide = q.axis !== k.line
        if (!qSide) continue
        const qRow = rowAt(q, k.at)
        if (!qRow) continue
        if (pEndsHere) {
          // Коридор (или холл) p упирается в бок q: продолжение — в ряду q напротив него.
          const a = Math.max(p.c0, k.from)
          const b = Math.min(p.c1, k.to)
          if (b - a >= corridor * 0.6) addSpecial(qRow, { a, b, kind: 'corridor', priority: 3 })
        } else if (p.axis !== k.line) {
          // Бок о бок: проход посередине общей стороны, через ряды обоих крыльев.
          const mid = Math.round((k.from + k.to) / 2)
          const a = mid - Math.round(corridor / 2)
          addSpecial(qRow, { a, b: a + corridor, kind: 'corridor', priority: 3 })
        }
      }
    }
  }
}

/** Торец крыла свободен, если к нему не примыкает ни одно другое крыло. */
function freeEnd(w: Wing, end: number, rects: Rect[]): boolean {
  return !rects.some((o) => {
    if (o === w.r) return false
    const k = contact(w.r, o)
    return !!k && k.line === w.axis && k.at === end
  })
}

/** В свободных торцах — лестница и туалет; без свободных торцов лестница всё равно нужна. */
function placeEnds(wings: Wing[], rects: Rect[]): void {
  let stairs = 0
  for (const w of wings) {
    if (w.type === 'hall' || w.l1 - w.l0 < STAIRS_MM * 2) continue
    for (const end of [w.l0, w.l1]) {
      if (!freeEnd(w, end, rects)) continue
      const [a, b] = end === w.l0 ? [w.l0, w.l0 + STAIRS_MM] : [w.l1 - STAIRS_MM, w.l1]
      const [first, second] =
        end === w.l0 ? [w.rows[0], w.rows[1]] : [w.rows[1] ?? w.rows[0], w.rows[0]]
      addSpecial(first, { a, b, kind: 'stairwell', priority: 2 })
      if (second && second !== first) addSpecial(second, { a, b, kind: 'restroom', priority: 2 })
      stairs++
    }
  }
  if (stairs === 0) {
    const w = largest(wings)
    if (w) addSpecial(w.rows[0], { a: w.l0, b: w.l0 + STAIRS_MM, kind: 'stairwell', priority: 2 })
  }
}

function largest(wings: Wing[]): Wing | undefined {
  return wings
    .filter((w) => w.type !== 'hall')
    .sort((a, b) => (b.l1 - b.l0) * (b.t1 - b.t0) - (a.l1 - a.l0) * (a.t1 - a.t0))[0]
}

/** Лифтовой холл — посередине самого большого крыла. */
function placeLifts(wings: Wing[], lifts: number): void {
  if (lifts <= 0) return
  const w = largest(wings)
  const row = w?.rows[0]
  if (!w || !row || w.l1 - w.l0 < LIFT_HALL_MM * 3) return
  const mid = Math.round((w.l0 + w.l1) / 2)
  addSpecial(row, {
    a: mid - LIFT_HALL_MM / 2,
    b: mid + LIFT_HALL_MM / 2,
    kind: 'elevator_hall',
    lifts: Math.min(4, lifts),
    priority: 1,
  })
}

/** Вход — в свободном торце коридора самого большого крыла. */
function entrancePoint(wings: Wing[], rects: Rect[]): Pt | null {
  const ordered = [largest(wings), ...wings].filter((w): w is Wing => !!w)
  for (const w of ordered) {
    for (const end of [w.l0, w.l1]) {
      if (!freeEnd(w, end, rects)) continue
      const across = Math.round((w.c0 + w.c1) / 2)
      return w.axis === 'x' ? { x: end, y: across } : { x: across, y: end }
    }
  }
  return null
}

/** Ячейки крыла: коридор, ряды кабинетов со спецячейками. */
function wingCells(w: Wing, roomW: number): Cell[] {
  const rect = (l0: number, l1: number, d0: number, d1: number): Rect =>
    w.axis === 'x' ? { x0: l0, x1: l1, y0: d0, y1: d1 } : { x0: d0, x1: d1, y0: l0, y1: l1 }
  if (w.type === 'hall') return [{ ...w.r, kind: 'hall' }]
  const out: Cell[] = [{ ...rect(w.l0, w.l1, w.c0, w.c1), kind: 'corridor' }]
  for (const row of w.rows) {
    // Наложение спецячеек: остаётся более важная (проход важнее лестницы, лестница — лифта).
    const specials = [...row.specials]
      .map((s) => ({ ...s, a: Math.max(w.l0, s.a), b: Math.min(w.l1, s.b) }))
      .filter((s) => s.b - s.a > 0)
      .sort((p, q) => q.priority - p.priority)
    const kept: Special[] = []
    for (const s of specials) if (!kept.some((k) => s.a < k.b && s.b > k.a)) kept.push(s)
    kept.sort((p, q) => p.a - q.a)
    let cur = w.l0
    const fill = (from: number, to: number): void => {
      const len = to - from
      if (len <= 0) return
      if (len < MIN_CELL_MM) {
        out.push({ ...rect(from, to, row.d0, row.d1), kind: 'storage' })
        return
      }
      const n = Math.max(1, Math.round(len / roomW))
      for (let i = 0; i < n; i++) {
        const a = Math.round(from + (len * i) / n)
        const b = Math.round(from + (len * (i + 1)) / n)
        out.push({ ...rect(a, b, row.d0, row.d1), kind: 'room' })
      }
    }
    for (const s of kept) {
      fill(cur, s.a)
      out.push({ ...rect(s.a, s.b, row.d0, row.d1), kind: s.kind, lifts: s.lifts })
      cur = s.b
    }
    fill(cur, w.l1)
  }
  return out
}

// ── Документ этажа ──────────────────────────────────────────────────────────────────

interface BuildOptions {
  level: number
  roomKind: SpaceKind
  partition: WallSpec
  entrance: Pt | null
  windows: boolean
  ids: IdGen
}

function buildDoc(ring: Pt[], cells: Cell[], o: BuildOptions): FloorPlanDoc {
  let doc = floorFromOutline(ring, o.ids)
  for (const c of cells) {
    const pts = [
      { x: c.x0, y: c.y0 },
      { x: c.x1, y: c.y0 },
      { x: c.x1, y: c.y1 },
      { x: c.x0, y: c.y1 },
    ]
    pts.forEach((p, i) => {
      doc = addWall(doc, p, pts[(i + 1) % 4]!, o.partition, o.ids).doc
    })
  }
  const inside = (c: Rect, p: Pt): boolean => p.x > c.x0 && p.x < c.x1 && p.y > c.y0 && p.y < c.y1
  const cellAt = (p: Pt): Cell | undefined => cells.find((c) => inside(c, p))
  // Стены между ячейками коридора и холлов — прочь: коридор одним пространством.
  for (const [id, w] of Object.entries(doc.walls)) {
    const a = doc.nodes[w.a]!
    const b = doc.nodes[w.b]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const nx = -(b.y - a.y) / len
    const ny = (b.x - a.x) / len
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const c1 = cellAt({ x: m.x + nx * 20, y: m.y + ny * 20 })
    const c2 = cellAt({ x: m.x - nx * 20, y: m.y - ny * 20 })
    if (c1 && c2 && CIRC.has(c1.kind) && CIRC.has(c2.kind)) doc = removeWall(doc, id, o.ids).doc
  }

  // Помещения: коридоры одной грани — одно помещение, остальные ячейки — по одному.
  const faces = buildFaces(doc).faces
  const spaces: Record<string, PlanSpace> = {}
  const newId = (kind: 's' | 'o' | 'v', taken: Record<string, unknown>): string => {
    for (;;) {
      const id = o.ids(kind)
      if (!(id in taken)) return id
    }
  }
  const circFaces = new Set<string>()
  const center = (c: Rect): Pt => ({
    x: Math.round((c.x0 + c.x1) / 2),
    y: Math.round((c.y0 + c.y1) / 2),
  })
  for (const c of cells.filter((x) => CIRC.has(x.kind))) {
    const f = faces.find((x) => faceContains(x, center(c)))
    if (!f || circFaces.has(f.id)) continue
    circFaces.add(f.id)
    spaces[newId('s', spaces)] = {
      label: center(c),
      edges: [],
      kind: c.kind === 'hall' ? 'hall' : 'corridor',
      visibility: 'public',
    }
  }
  const prefix = o.level <= 0 ? '0' : String(o.level)
  let n = 0
  for (const c of cells.filter((x) => !CIRC.has(x.kind))) {
    const kind: SpaceKind = c.kind === 'room' ? o.roomKind : c.kind
    const space: PlanSpace = {
      label: center(c),
      edges: [],
      kind,
      visibility: HIDDEN_BY_DEFAULT_KINDS.includes(kind) ? 'hidden' : 'public',
    }
    if (c.kind === 'room') space.number = `${prefix}${String(++n).padStart(2, '0')}`
    spaces[newId('s', spaces)] = space
  }
  doc = matchSpaces({ ...doc, spaces }).doc

  // Двери, лестницы, лифты.
  const openings: Record<string, PlanOpening> = {}
  const verticals: Record<string, PlanVertical> = {}
  const door = (at: Pt, width: number, type: 'door' | 'window' = 'door'): boolean => {
    for (const [wid, w] of Object.entries(doc.walls)) {
      const a = doc.nodes[w.a]!
      const b = doc.nodes[w.b]!
      const pr = projectOnSegment(at, a, b)
      if (pr.distance > 2) continue
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      const offset = Math.round(pr.t * len - width / 2)
      if (offset < 50 || offset + width > len - 50) continue
      openings[newId('o', openings)] =
        type === 'door'
          ? {
              type,
              wallId: wid,
              offsetMm: offset,
              widthMm: width,
              heightMm: 2100,
              swing: width > 1000 ? 'none' : 'left-in',
              access: 'public',
            }
          : { type, wallId: wid, offsetMm: offset, widthMm: width, heightMm: 1500, sillMm: 900 }
      return true
    }
    return false
  }
  const circ = cells.filter((x) => CIRC.has(x.kind))
  for (const c of cells.filter((x) => !CIRC.has(x.kind))) {
    const edge = circ
      .map((q) => shared(c, q))
      .filter((e): e is SharedEdge => !!e && e.len >= 1200)
      .sort((p, q) => q.len - p.len)[0]
    if (!edge) continue
    const at = {
      x: Math.round((edge.a.x + edge.b.x) / 2),
      y: Math.round((edge.a.y + edge.b.y) / 2),
    }
    door(at, c.kind === 'elevator_hall' ? WIDE_DOOR_MM : DOOR_MM)
    // Внутрь ячейки — от двери.
    const into = { x: -edge.dir.x, y: -edge.dir.y }
    if (c.kind === 'stairwell') {
      const inset = { x0: 300, y0: 300, x1: 300, y1: 300 }
      if (into.x === 1) inset.x0 = 1400
      if (into.x === -1) inset.x1 = 1400
      if (into.y === 1) inset.y0 = 1400
      if (into.y === -1) inset.y1 = 1400
      const r = {
        x0: c.x0 + inset.x0,
        y0: c.y0 + inset.y0,
        x1: c.x1 - inset.x1,
        y1: c.y1 - inset.y1,
      }
      if (r.x1 - r.x0 > 500 && r.y1 - r.y0 > 500) {
        verticals[newId('v', verticals)] = {
          type: 'stairs',
          groupId: `auto-st-${c.x0}-${c.y0}`,
          outline: rectOutline(r),
          stepFree: false,
          landing: { x: at.x + into.x * 700, y: at.y + into.y * 700 },
        }
      }
    }
    if (c.kind === 'elevator_hall' && c.lifts) {
      const alongX = into.y !== 0
      const [s0, s1] = alongX ? [c.x0, c.x1] : [c.y0, c.y1]
      const w = (s1 - s0) / c.lifts
      for (let k = 0; k < c.lifts; k++) {
        const a = Math.round(s0 + w * k + 150)
        const b = Math.round(s0 + w * (k + 1) - 150)
        const far = alongX
          ? into.y === 1
            ? c.y1 - 200
            : c.y0 + 200
          : into.x === 1
            ? c.x1 - 200
            : c.x0 + 200
        const near = far - (alongX ? into.y : into.x) * 2000
        const r = alongX
          ? { x0: a, x1: b, y0: Math.min(far, near), y1: Math.max(far, near) }
          : { y0: a, y1: b, x0: Math.min(far, near), x1: Math.max(far, near) }
        const mid = Math.round((a + b) / 2)
        verticals[newId('v', verticals)] = {
          type: 'elevator',
          groupId: `auto-el-${c.x0}-${c.y0}-${k}`,
          outline: rectOutline(r),
          stepFree: true,
          landing: alongX ? { x: mid, y: at.y + into.y * 800 } : { x: at.x + into.x * 800, y: mid },
        }
      }
    }
  }
  if (o.entrance) door(o.entrance, WIDE_DOOR_MM)
  doc = { ...doc, openings, verticals }

  if (o.windows) doc = withWindows(doc, o.ids)
  return doc
}

function rectOutline(r: Rect): [number, number][] {
  return [
    [r.x0, r.y0],
    [r.x1, r.y0],
    [r.x1, r.y1],
    [r.x0, r.y1],
  ]
}

interface SharedEdge {
  a: Pt
  b: Pt
  len: number
  /** Нормаль от ячейки к коридору. */
  dir: Pt
}

function shared(p: Rect, q: Rect): SharedEdge | null {
  if (p.x1 === q.x0 || p.x0 === q.x1) {
    const x = p.x1 === q.x0 ? p.x1 : p.x0
    const lo = Math.max(p.y0, q.y0)
    const hi = Math.min(p.y1, q.y1)
    return hi > lo
      ? { a: { x, y: lo }, b: { x, y: hi }, len: hi - lo, dir: { x: x === p.x1 ? 1 : -1, y: 0 } }
      : null
  }
  if (p.y1 === q.y0 || p.y0 === q.y1) {
    const y = p.y1 === q.y0 ? p.y1 : p.y0
    const lo = Math.max(p.x0, q.x0)
    const hi = Math.min(p.x1, q.x1)
    return hi > lo
      ? { a: { x: lo, y }, b: { x: hi, y }, len: hi - lo, dir: { x: 0, y: y === p.y1 ? 1 : -1 } }
      : null
  }
  return null
}

/** Окна по наружным стенам: шаг ~3 м, мимо дверей. */
function withWindows(doc: FloorPlanDoc, ids: IdGen): FloorPlanDoc {
  const faces = buildFaces(doc).faces
  const inAny = (p: Pt): boolean => faces.some((f) => faceContains(f, p))
  const openings = { ...doc.openings }
  for (const [wid, w] of Object.entries(doc.walls)) {
    if (w.kind !== 'wall') continue
    const a = doc.nodes[w.a]!
    const b = doc.nodes[w.b]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 1900) continue
    const ux = (b.x - a.x) / len
    const uy = (b.y - a.y) / len
    const at = (s: number, side: number): Pt => ({
      x: Math.round(a.x + ux * s - uy * side),
      y: Math.round(a.y + uy * s + ux * side),
    })
    if (inAny(at(len / 2, 300)) === inAny(at(len / 2, -300))) continue
    const busy = Object.values(openings)
      .filter((op) => op.wallId === wid)
      .map((op) => [op.offsetMm - 150, op.offsetMm + op.widthMm + 150] as const)
    const usable = len - 1000
    const n = Math.max(1, Math.round(usable / 3000))
    const width = Math.min(1500, Math.floor(usable / n - 300))
    if (width < 600) continue
    for (let i = 0; i < n; i++) {
      const from = Math.round(500 + (usable * (i + 0.5)) / n - width / 2)
      if (busy.some(([p, q]) => from < q && from + width > p)) continue
      let id = ids('o')
      while (id in openings) id = ids('o')
      openings[id] = {
        type: 'window',
        wallId: wid,
        offsetMm: from,
        widthMm: width,
        heightMm: 1500,
        sillMm: 900,
      }
    }
  }
  return { ...doc, openings }
}
