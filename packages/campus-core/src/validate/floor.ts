import { ACADEMIC_SPACE_KINDS, type FloorPlanDoc } from '../format/schema.js'
import { distance, insideSegment, segmentContact, samePoint } from '../geom/int.js'
import { signedArea2 } from '../geom/polygon.js'
import { buildFaces, faceContains, type Face } from '../topology/faces.js'

/**
 * Проверка этажа (docs/CAMPUS_BUILDER.md §11.6). Ошибки блокируют публикацию, предупреждения
 * — нет. Путь (`path`) указывает на объект документа: редактор подсвечивает его по клику в
 * панели «Проверка», а сервер отдаёт его в `details[].field` ответа VALIDATION_ERROR.
 */
export type ProblemSeverity = 'error' | 'warning'

export type ProblemCode =
  | 'BROKEN_REF'
  | 'DUPLICATE_NODE'
  | 'ZERO_LENGTH_WALL'
  | 'DUPLICATE_WALL'
  | 'NOT_PLANAR'
  | 'SHORT_WALL'
  | 'DANGLING_WALL'
  | 'ISOLATED_NODE'
  | 'OPENING_PARKED'
  | 'OPENING_OUT_OF_WALL'
  | 'OPENINGS_OVERLAP'
  | 'OPENING_TOO_HIGH'
  | 'SPACE_LOST'
  | 'SPACE_LABEL_OUTSIDE'
  | 'SPACE_TOO_SMALL'
  | 'ROOM_REQUIRED'
  | 'DUPLICATE_ROOM'
  | 'VERTICAL_DEGENERATE'

export interface Problem {
  code: ProblemCode
  severity: ProblemSeverity
  path: string
  ids: string[]
}

/** Стена короче — почти наверняка промах мышью (§11.6). */
export const MIN_WALL_MM = 50
/** Помещение меньше 0,5 м² — тоже. */
export const MIN_SPACE_MM2 = 500_000

export interface ValidateOptions {
  /** Высота этажа — для проверки, что окно не выше стены. */
  floorHeightMm?: number
  /** Уже посчитанные грани — чтобы не строить их второй раз. */
  faces?: Face[]
}

export function validateFloor(doc: FloorPlanDoc, options: ValidateOptions = {}): Problem[] {
  const problems: Problem[] = []
  const push = (
    code: ProblemCode,
    severity: ProblemSeverity,
    path: string,
    ids: string[],
  ): void => {
    problems.push({ code, severity, path, ids })
  }

  // ── Узлы и стены ──────────────────────────────────────────────────────────────────
  const byPoint = new Map<string, string>()
  for (const [id, n] of Object.entries(doc.nodes)) {
    const key = `${n.x},${n.y}`
    const other = byPoint.get(key)
    if (other) push('DUPLICATE_NODE', 'error', `nodes.${id}`, [other, id])
    else byPoint.set(key, id)
  }

  const degree = new Map<string, number>()
  const validWalls: string[] = []
  const pairs = new Map<string, string>()
  for (const [id, w] of Object.entries(doc.walls)) {
    const a = doc.nodes[w.a]
    const b = doc.nodes[w.b]
    if (!a || !b) {
      push('BROKEN_REF', 'error', `walls.${id}`, [id])
      continue
    }
    if (w.a === w.b || samePoint(a, b)) {
      push('ZERO_LENGTH_WALL', 'error', `walls.${id}`, [id])
      continue
    }
    const pair = w.a < w.b ? `${w.a}|${w.b}` : `${w.b}|${w.a}`
    const twin = pairs.get(pair)
    if (twin) push('DUPLICATE_WALL', 'error', `walls.${id}`, [twin, id])
    else pairs.set(pair, id)
    degree.set(w.a, (degree.get(w.a) ?? 0) + 1)
    degree.set(w.b, (degree.get(w.b) ?? 0) + 1)
    if (distance(a, b) < MIN_WALL_MM) push('SHORT_WALL', 'warning', `walls.${id}`, [id])
    validWalls.push(id)
  }

  for (const id of Object.keys(doc.nodes)) {
    const d = degree.get(id) ?? 0
    if (d === 0) push('ISOLATED_NODE', 'warning', `nodes.${id}`, [id])
  }
  for (const [id, w] of Object.entries(doc.walls)) {
    if ((degree.get(w.a) ?? 0) === 1 || (degree.get(w.b) ?? 0) === 1) {
      if (doc.nodes[w.a] && doc.nodes[w.b] && w.a !== w.b) {
        push('DANGLING_WALL', 'warning', `walls.${id}`, [id])
      }
    }
  }

  // Планарность: стены касаются только общими узлами. Отсечение по X после сортировки.
  const spans = validWalls
    .map((id) => {
      const w = doc.walls[id]!
      const a = doc.nodes[w.a]!
      const b = doc.nodes[w.b]!
      return { id, a, b, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) }
    })
    .sort((s, t) => s.lo - t.lo)
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]!
    for (let j = i + 1; j < spans.length && spans[j]!.lo <= s.hi; j++) {
      const t = spans[j]!
      const contact = segmentContact(s.a, s.b, t.a, t.b)
      if (contact.kind === 'none') continue
      const points = contact.kind === 'point' ? [contact.p] : contact.points
      const crossing = points.some((p) => insideSegment(p, s.a, s.b) || insideSegment(p, t.a, t.b))
      if (crossing) push('NOT_PLANAR', 'error', `walls.${s.id}`, [s.id, t.id])
    }
  }

  // ── Проёмы ────────────────────────────────────────────────────────────────────────
  const byWall = new Map<string, { id: string; from: number; to: number }[]>()
  for (const [id, o] of Object.entries(doc.openings)) {
    if (o.wallId === null) {
      push('OPENING_PARKED', 'warning', `openings.${id}`, [id])
      continue
    }
    const w = doc.walls[o.wallId]
    const a = w && doc.nodes[w.a]
    const b = w && doc.nodes[w.b]
    if (!w || !a || !b) {
      push('BROKEN_REF', 'error', `openings.${id}`, [id])
      continue
    }
    if (o.offsetMm + o.widthMm > distance(a, b)) {
      push('OPENING_OUT_OF_WALL', 'error', `openings.${id}`, [id, o.wallId])
    }
    const height = w.heightMm ?? options.floorHeightMm
    const top = o.type === 'window' ? o.sillMm + o.heightMm : o.heightMm
    if (height !== undefined && top > height) {
      push('OPENING_TOO_HIGH', 'error', `openings.${id}`, [id])
    }
    const list = byWall.get(o.wallId) ?? []
    list.push({ id, from: o.offsetMm, to: o.offsetMm + o.widthMm })
    byWall.set(o.wallId, list)
  }
  for (const list of byWall.values()) {
    list.sort((p, q) => p.from - q.from)
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!
      const cur = list[i]!
      if (cur.from < prev.to)
        push('OPENINGS_OVERLAP', 'error', `openings.${cur.id}`, [prev.id, cur.id])
    }
  }

  // ── Помещения ─────────────────────────────────────────────────────────────────────
  const faces = options.faces ?? buildFaces(doc).faces
  const faceByWalls = new Map(faces.map((f) => [[...f.wallIds].sort().join('|'), f]))
  const roomOwners = new Map<string, string>()
  for (const [id, s] of Object.entries(doc.spaces)) {
    const face = faceByWalls.get([...s.edges].sort().join('|'))
    if (!face) {
      push('SPACE_LOST', 'error', `spaces.${id}`, [id])
    } else {
      if (!faceContains(face, s.label)) push('SPACE_LABEL_OUTSIDE', 'warning', `spaces.${id}`, [id])
      if (face.areaMm2 < MIN_SPACE_MM2) push('SPACE_TOO_SMALL', 'warning', `spaces.${id}`, [id])
    }
    if (ACADEMIC_SPACE_KINDS.includes(s.kind) && !s.roomId) {
      push('ROOM_REQUIRED', 'error', `spaces.${id}.roomId`, [id])
    }
    if (s.roomId) {
      const owner = roomOwners.get(s.roomId)
      if (owner) push('DUPLICATE_ROOM', 'error', `spaces.${id}.roomId`, [owner, id])
      else roomOwners.set(s.roomId, id)
    }
  }

  // ── Лестницы и лифты ──────────────────────────────────────────────────────────────
  for (const [id, v] of Object.entries(doc.verticals)) {
    const points = v.outline.map(([x, y]) => ({ x, y }))
    if (signedArea2(points) === 0) push('VERTICAL_DEGENERATE', 'error', `verticals.${id}`, [id])
  }

  return problems
}

/** Есть ли среди проблем блокирующие публикацию. */
export function hasErrors(problems: readonly Problem[]): boolean {
  return problems.some((p) => p.severity === 'error')
}
