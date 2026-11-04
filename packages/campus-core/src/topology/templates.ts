import type { FloorPlanDoc, PlanSpace, SpaceKind } from '../format/schema.js'
import { randomIds, type IdGen } from '../format/ids.js'
import { onSegment, type Pt } from '../geom/int.js'
import { interiorPoint } from '../geom/polygon.js'
import { addWall, removeWall, wallLength, type EditResult, type WallSpec } from './edit.js'
import { buildFaces, faceContains, type Face } from './faces.js'
import { matchSpaces } from './match-spaces.js'
import { WALL } from '../fixtures/edge-cases.js'

/**
 * Шаблоны планировки (docs/CAMPUS_BUILDER.md §12.9): рисование «с нуля» без подложки быстрее,
 * когда типовые куски ставятся одним действием. Работают поверх уже нарисованного — стены
 * встраиваются в граф обычным `addWall`, пересечения расщепляются.
 */

/** Происхождение после серии правок: корень — стена исходного документа. */
function compose(into: Record<string, string>, next: Record<string, string>): void {
  for (const [id, parent] of Object.entries(next)) into[id] = into[parent] ?? parent
}

/** Прямоугольная комната x,y — левый нижний угол, w×h в мм. */
export function addRoomRect(
  doc: FloorPlanDoc,
  x: number,
  y: number,
  w: number,
  h: number,
  spec: WallSpec = WALL,
  ids: IdGen = randomIds,
): EditResult {
  const pts = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
  let cur = doc
  const lineage: Record<string, string> = {}
  pts.forEach((p, i) => {
    const r = addWall(cur, p, pts[(i + 1) % 4]!, spec, ids)
    compose(lineage, r.lineage)
    cur = r.doc
  })
  return { doc: cur, lineage, created: Object.keys(cur.walls).filter((id) => !(id in doc.walls)) }
}

export interface CorridorOptions {
  /** Прямоугольник, внутри которого коридор (обычно габарит корпуса), мм. */
  x0: number
  y0: number
  x1: number
  y1: number
  corridorMm: number
  roomWidthMm: number
  /** Коридор вдоль длинной стороны — по умолчанию; можно повернуть. */
  axis?: 'auto' | 'x' | 'y'
}

/**
 * «Коридор с комнатами по обе стороны»: две стены коридора по оси прямоугольника и
 * перегородки комнат через `roomWidthMm`. Самая частая схема учебного корпуса.
 */
export function addCorridorWithRooms(
  doc: FloorPlanDoc,
  o: CorridorOptions,
  spec: WallSpec = WALL,
  ids: IdGen = randomIds,
): EditResult {
  const along = o.axis === 'x' || (o.axis !== 'y' && o.x1 - o.x0 >= o.y1 - o.y0) ? 'x' : 'y'
  const lineage: Record<string, string> = {}
  let cur = doc
  const wall = (ax: number, ay: number, bx: number, by: number): void => {
    const r = addWall(cur, { x: ax, y: ay }, { x: bx, y: by }, spec, ids)
    compose(lineage, r.lineage)
    cur = r.doc
  }
  if (along === 'x') {
    const mid = Math.round((o.y0 + o.y1) / 2)
    const lo = mid - Math.round(o.corridorMm / 2)
    const hi = lo + o.corridorMm
    wall(o.x0, lo, o.x1, lo)
    wall(o.x0, hi, o.x1, hi)
    for (let x = o.x0 + o.roomWidthMm; x < o.x1 - o.roomWidthMm / 3; x += o.roomWidthMm) {
      wall(x, o.y0, x, lo)
      wall(x, hi, x, o.y1)
    }
  } else {
    const mid = Math.round((o.x0 + o.x1) / 2)
    const lo = mid - Math.round(o.corridorMm / 2)
    const hi = lo + o.corridorMm
    wall(lo, o.y0, lo, o.y1)
    wall(hi, o.y0, hi, o.y1)
    for (let y = o.y0 + o.roomWidthMm; y < o.y1 - o.roomWidthMm / 3; y += o.roomWidthMm) {
      wall(o.x0, y, lo, y)
      wall(hi, y, o.x1, y)
    }
  }
  return { doc: cur, lineage, created: Object.keys(cur.walls).filter((id) => !(id in doc.walls)) }
}

/** Сложение двух шагов правки в один (для команд редактора из нескольких операций). */
export function composeEdits(first: EditResult, second: EditResult): EditResult {
  const lineage = { ...first.lineage }
  compose(lineage, second.lineage)
  return { doc: second.doc, lineage, created: [...new Set([...first.created, ...second.created])] }
}

export interface SplitRoomsOptions {
  /** На сколько комнат делить, 2…50. */
  count: number
  /** Двери в коридор: ширина, мм. 0 — без дверей. */
  doorWidthMm?: number
  /** Куда ведут двери: соседние помещения этих типов считаются коридором. */
  corridorKinds?: readonly SpaceKind[]
}

/** Соседи, куда новая комната открывает дверь, — коридор, холл, лифтовой холл. */
export const CORRIDOR_KINDS: readonly SpaceKind[] = ['corridor', 'hall', 'elevator_hall']

/** Узже метра комната не получится — делить нечего. */
const MIN_PART_MM = 1000
/** Выход разреза за стену, когда точка пересечения не легла на неё ровно (наклонная стена). */
const OVERSHOOT_MM = 3
const STUB_MM = 10

/**
 * «Разбить на комнаты»: помещение режется на `count` равных частей поперёк своей длинной
 * стороны — так полосу вдоль коридора превращают в ряд кабинетов одним действием. Каждая
 * часть сразу становится помещением того же назначения со следующим номером («101» →
 * «102», «103»…), а у частей без двери появляется дверь в соседний коридор посередине общей
 * стены. Исходное помещение остаётся у одной из частей со своим номером и связью.
 *
 * Работает для любой формы: разрез ведётся по всей ширине области, участки снаружи
 * отбрасываются. null — делить нечего (помещение потеряно или части уже метра).
 */
export function splitSpaceIntoRooms(
  doc: FloorPlanDoc,
  spaceId: string,
  options: SplitRoomsOptions,
  spec: WallSpec = WALL,
  ids: IdGen = randomIds,
): EditResult | null {
  const space = doc.spaces[spaceId]
  const count = Math.round(options.count)
  if (!space || count < 2 || count > 50) return null
  const faces = buildFaces(doc).faces
  const faceId = matchSpaces(doc, {}, faces).assignments[spaceId]
  const face = faces.find((f) => f.id === faceId)
  if (!face) return null
  const ring = face.outer.points

  // Ось — вдоль самой длинной стороны контура; разрезы — поперёк неё.
  let best = { len: 0, ux: 1, uy: 0 }
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len > best.len) best = { len, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len }
  })
  const { ux, uy } = best
  const along = (p: Pt): number => p.x * ux + p.y * uy
  const across = (p: Pt): number => -p.x * uy + p.y * ux
  const s0 = Math.min(...ring.map(along))
  const s1 = Math.max(...ring.map(along))
  if ((s1 - s0) / count < MIN_PART_MM) return null

  const lineage: Record<string, string> = {}
  let cur = doc
  const created = new Set<string>()
  const wall = (p: Pt, q: Pt): void => {
    const r = addWall(cur, p, q, spec, ids)
    compose(lineage, r.lineage)
    for (const id of r.created) created.add(id)
    cur = r.doc
  }
  const onRing = (p: Pt): boolean =>
    ring.some((a, i) => onSegment(p, a, ring[(i + 1) % ring.length]!))

  for (let k = 1; k < count; k++) {
    const s = s0 + ((s1 - s0) * k) / count
    // Пересечения линии разреза с контуром: правило полуоткрытого отрезка — вершина на
    // линии считается один раз.
    const hits: Pt[] = []
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length]!
      const da = along(a) - s
      const db = along(b) - s
      if (da > 0 === db > 0) return
      const t = da / (da - db)
      hits.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    })
    hits.sort((p, q) => across(p) - across(q))
    for (let i = 0; i + 1 < hits.length; i += 2) {
      const p = hits[i]!
      const q = hits[i + 1]!
      const mid = { x: Math.round((p.x + q.x) / 2), y: Math.round((p.y + q.y) / 2) }
      if (!faceContains(face, mid)) continue
      const len = Math.hypot(q.x - p.x, q.y - p.y)
      if (len < 1) continue
      const dx = (q.x - p.x) / len
      const dy = (q.y - p.y) / len
      // Концы ложатся точно на стену, если координаты целые (прямые углы — почти всегда).
      // На наклонной стене округлённая точка мимо неё: тогда разрез чуть длиннее, стена его
      // режет сама, а хвостик снаружи убирается ниже.
      const end = (pt: Pt, sign: number): Pt => {
        const r = { x: Math.round(pt.x), y: Math.round(pt.y) }
        if (onRing(r)) return r
        return {
          x: Math.round(pt.x + sign * dx * OVERSHOOT_MM),
          y: Math.round(pt.y + sign * dy * OVERSHOOT_MM),
        }
      }
      wall(end(p, -1), end(q, 1))
    }
  }
  if (created.size === 0) return null

  // Хвостики разрезов за стеной: короткие стены, у которых один конец ни к чему не примыкает.
  for (;;) {
    const degree = new Map<string, number>()
    for (const w of Object.values(cur.walls)) {
      degree.set(w.a, (degree.get(w.a) ?? 0) + 1)
      degree.set(w.b, (degree.get(w.b) ?? 0) + 1)
    }
    const stub = [...created].find((id) => {
      const w = cur.walls[id]
      if (!w) return false
      const a = cur.nodes[w.a]!
      const b = cur.nodes[w.b]!
      return (
        Math.hypot(b.x - a.x, b.y - a.y) <= STUB_MM &&
        (degree.get(w.a) === 1 || degree.get(w.b) === 1)
      )
    })
    if (!stub) break
    created.delete(stub)
    cur = removeWall(cur, stub, ids).doc
  }

  // Помещения частей: исходное осталось у одной, остальным — то же назначение и номера по
  // порядку вдоль оси.
  const facesAfter = buildFaces(cur).faces
  const matched = matchSpaces(cur, lineage, facesAfter)
  cur = matched.doc
  const ownFace = matched.assignments[spaceId]
  const taken = new Set(Object.values(matched.assignments))
  const parts = facesAfter
    .map((f) => ({
      f,
      label: interiorPoint(
        f.outer.points,
        f.holes.map((h) => h.points),
      ),
    }))
    .filter(
      (x): x is { f: Face; label: Pt } =>
        x.label !== null &&
        faceContains(face, x.label) &&
        (x.f.id === ownFace || !taken.has(x.f.id)),
    )
    .sort((a, b) => along(a.label) - along(b.label))
  const used = new Set(
    Object.values(cur.spaces)
      .map((sp) => sp.number)
      .filter((n): n is string => !!n),
  )
  let number = space.number
  const spaces = { ...cur.spaces }
  const spaceOfFace = new Map<string, string>([[ownFace ?? '', spaceId]])
  for (const part of parts) {
    if (part.f.id === ownFace) continue
    number = number ? nextNumber(number, used) : undefined
    if (number) used.add(number)
    let sid = ids('s')
    while (sid in spaces) sid = ids('s')
    const next: PlanSpace = {
      label: part.label,
      edges: [],
      kind: space.kind,
      visibility: space.visibility,
    }
    if (number) next.number = number
    spaces[sid] = next
    spaceOfFace.set(part.f.id, sid)
  }
  cur = { ...cur, spaces }

  // Двери в коридор — тем частям, у которых двери ещё нет.
  const doorWidth = options.doorWidthMm ?? 900
  if (doorWidth > 0) {
    const corridorKinds = options.corridorKinds ?? CORRIDOR_KINDS
    const facesOfWall = new Map<string, string[]>()
    for (const f of facesAfter) {
      for (const w of f.wallIds) facesOfWall.set(w, [...(facesOfWall.get(w) ?? []), f.id])
    }
    const spaceAt = invertAssignments(matched.assignments)
    const openings = { ...cur.openings }
    const doorOn = new Set(
      Object.values(openings)
        .filter((o) => o.type === 'door' && o.wallId)
        .map((o) => o.wallId!),
    )
    for (const part of parts) {
      if (part.f.wallIds.some((w) => doorOn.has(w))) continue
      const candidates = part.f.wallIds
        .filter((w) => {
          const wl = cur.walls[w]
          if (!wl || wl.kind === 'virtual') return false
          const other = (facesOfWall.get(w) ?? []).find((id) => id !== part.f.id)
          const sid = other ? spaceAt[other] : undefined
          const kind = sid ? cur.spaces[sid]?.kind : undefined
          return !!kind && corridorKinds.includes(kind)
        })
        .map((w) => ({ w, len: wallLength(cur, w) }))
        .filter((x) => x.len >= doorWidth + 200)
        .sort((a, b) => b.len - a.len)
      const target = candidates[0]
      if (!target) continue
      let oid = ids('o')
      while (oid in openings) oid = ids('o')
      openings[oid] = {
        type: 'door',
        wallId: target.w,
        offsetMm: Math.round((target.len - doorWidth) / 2),
        widthMm: doorWidth,
        heightMm: 2100,
        swing: 'left-in',
        access: 'public',
      }
      doorOn.add(target.w)
    }
    cur = { ...cur, openings }
  }

  // Рёбра новым помещениям — сразу: документ уходит в сохранение цельным.
  cur = matchSpaces(cur, {}, facesAfter).doc
  return { doc: cur, lineage, created: [...created].filter((id) => id in cur.walls) }
}

/** Следующий свободный номер: «101» → «102», «А-09» → «А-10»; без цифр — null. */
function nextNumber(number: string, used: Set<string>): string | undefined {
  const m = /^(.*?)(\d+)(\D*)$/.exec(number)
  if (!m) return undefined
  const [, head = '', digits = '', tail = ''] = m
  let n = Number(digits)
  for (let guard = 0; guard < 1000; guard++) {
    n += 1
    const candidate = `${head}${String(n).padStart(digits.length, '0')}${tail}`
    if (!used.has(candidate)) return candidate
  }
  return undefined
}

function invertAssignments(assignments: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [spaceId, faceId] of Object.entries(assignments)) out[faceId] = spaceId
  return out
}
