import { emptyFloorPlan, type FloorPlanDoc, type PlanSpace } from '../format/schema.js'
import { randomIds, type IdGen } from '../format/ids.js'
import { segmentContact, samePoint, type Pt } from '../geom/int.js'
import { signedArea2 } from '../geom/polygon.js'
import { addWall, type WallSpec } from './edit.js'

/**
 * Корпус: контур, положение на территории, старт этажа и копирование этажа
 * (docs/CAMPUS_BUILDER.md §6, §12.7, §12.9).
 */
export interface BuildingTransform {
  x: number
  y: number
  rotationDeg: number
}

export type OutlineProblem =
  'TOO_FEW_POINTS' | 'DUPLICATE_POINTS' | 'ZERO_AREA' | 'SELF_INTERSECTION'

/**
 * Проверка контура корпуса: не меньше трёх точек, без повторов, ненулевая площадь, без
 * самопересечений (рёбра касаются только соседей в общей вершине).
 */
export function checkOutline(outline: readonly Pt[]): OutlineProblem | null {
  const n = outline.length
  if (n < 3) return 'TOO_FEW_POINTS'
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++)
      if (samePoint(outline[i]!, outline[j]!)) return 'DUPLICATE_POINTS'
  }
  for (let i = 0; i < n; i++) {
    const a = outline[i]!
    const b = outline[(i + 1) % n]!
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1)
      const c = outline[j]!
      const d = outline[(j + 1) % n]!
      const contact = segmentContact(a, b, c, d)
      if (contact.kind === 'none') continue
      if (adjacent && contact.kind === 'point') continue
      return 'SELF_INTERSECTION'
    }
  }
  // После самопересечений: у симметричной «бабочки» площадь тоже нулевая, но причина — она.
  if (signedArea2(outline) === 0) return 'ZERO_AREA'
  return null
}

/** Контур против часовой стрелки — так его ждут грани и 3D. */
export function normalizeOutline(outline: readonly Pt[]): Pt[] {
  return signedArea2(outline) < 0 ? [...outline].reverse() : [...outline]
}

/** Точка из системы корпуса в систему кампуса: поворот вокруг начала корпуса, затем сдвиг. */
export function toCampus(p: Pt, t: BuildingTransform): Pt {
  const r = (t.rotationDeg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return { x: Math.round(t.x + p.x * cos - p.y * sin), y: Math.round(t.y + p.x * sin + p.y * cos) }
}

/** Обратное преобразование: из кампуса в систему корпуса. */
export function toBuilding(p: Pt, t: BuildingTransform): Pt {
  const r = (-t.rotationDeg * Math.PI) / 180
  const dx = p.x - t.x
  const dy = p.y - t.y
  return {
    x: Math.round(dx * Math.cos(r) - dy * Math.sin(r)),
    y: Math.round(dx * Math.sin(r) + dy * Math.cos(r)),
  }
}

/** Наружные стены по умолчанию — толще перегородок. */
export const OUTER_WALL: WallSpec = { thicknessMm: 400, kind: 'wall' }

/**
 * Новый этаж начинается с наружных стен по контуру корпуса: каркас этажа берётся из корпуса
 * — остаётся нарисовать перегородки.
 */
export function floorFromOutline(outline: readonly Pt[], ids: IdGen = randomIds): FloorPlanDoc {
  let doc = emptyFloorPlan()
  const ring = normalizeOutline(outline)
  ring.forEach((p, i) => {
    doc = addWall(doc, p, ring[(i + 1) % ring.length]!, OUTER_WALL, ids).doc
  })
  return doc
}

/**
 * Этаж ещё не тронут: на нём только наружные стены по контуру корпуса, как их поставил
 * `floorFromOutline`, — ни перегородок, ни проёмов, ни помещений. Такой этаж можно молча
 * пересобрать по новому контуру или перезаписать копией: терять на нём нечего.
 */
export function isBareOutlineFloor(doc: FloorPlanDoc, outline: readonly Pt[]): boolean {
  if (
    Object.keys(doc.openings).length > 0 ||
    Object.keys(doc.spaces).length > 0 ||
    Object.keys(doc.verticals).length > 0 ||
    Object.keys(doc.labels).length > 0
  )
    return false
  const walls = Object.values(doc.walls)
  if (walls.length === 0) return true
  if (walls.length !== outline.length) return false
  const keyOf = (p: Pt): string => `${p.x},${p.y}`
  const edge = (p: Pt, q: Pt): string => [keyOf(p), keyOf(q)].sort().join('|')
  const ring = new Set(outline.map((p, i) => edge(p, outline[(i + 1) % outline.length]!)))
  return walls.every((w) => {
    const a = doc.nodes[w.a]
    const b = doc.nodes[w.b]
    return !!a && !!b && ring.has(edge(a, b))
  })
}

export interface CloneOptions {
  /**
   * Сдвиг номеров помещений: «3» → «4» превращает «А305» в «А405». Меняется первое вхождение
   * префикса после буквенного кода корпуса; номера без него не трогаются.
   */
  renumber?: { from: string; to: string }
}

/**
 * Копия этажа с новыми id для всех объектов и переадресацией всех ссылок внутри (§12.7).
 * Связь с Room сбрасывается — одна Room не бывает на двух этажах. Лестницы и лифты сохраняют
 * `groupId`: лестница продолжается на новый этаж.
 */
export function cloneFloorPlan(
  doc: FloorPlanDoc,
  ids: IdGen = randomIds,
  options: CloneOptions = {},
): FloorPlanDoc {
  const map = new Map<string, string>()
  // Новые id не совпадают ни с одним старым: копия живёт в другом документе, но ссылки
  // «старый → новый» должны быть однозначны.
  const used = new Set<string>([
    ...Object.keys(doc.nodes),
    ...Object.keys(doc.walls),
    ...Object.keys(doc.openings),
    ...Object.keys(doc.spaces),
    ...Object.keys(doc.verticals),
    ...Object.keys(doc.labels),
  ])
  const remap = <T>(src: Record<string, T>, kind: Parameters<IdGen>[0]): Record<string, T> => {
    const out: Record<string, T> = {}
    for (const [id, value] of Object.entries(src)) {
      let next = ids(kind)
      while (used.has(next)) next = ids(kind)
      used.add(next)
      map.set(id, next)
      out[next] = value
    }
    return out
  }
  const nodes = remap(doc.nodes, 'n')
  const wallsRaw = remap(doc.walls, 'w')
  const openingsRaw = remap(doc.openings, 'o')
  const spacesRaw = remap(doc.spaces, 's')
  const verticals = remap(doc.verticals, 'v')
  const labels = remap(doc.labels, 't')
  const id = (old: string): string => map.get(old) ?? old

  const walls: FloorPlanDoc['walls'] = {}
  for (const [k, w] of Object.entries(wallsRaw)) walls[k] = { ...w, a: id(w.a), b: id(w.b) }
  const openings: FloorPlanDoc['openings'] = {}
  for (const [k, o] of Object.entries(openingsRaw)) {
    openings[k] = { ...o, wallId: o.wallId === null ? null : id(o.wallId) }
  }
  const spaces: FloorPlanDoc['spaces'] = {}
  for (const [k, s] of Object.entries(spacesRaw)) {
    const { roomId: _roomId, ...rest } = s
    const next: PlanSpace = { ...rest, edges: s.edges.map(id) }
    if (options.renumber && s.number) next.number = renumber(s.number, options.renumber)
    spaces[k] = next
  }
  return { ...doc, nodes, walls, openings, spaces, verticals, labels }
}

/**
 * Перенумерация копии этажа по уровням: с 1-го на 3-й — «1» → «3», «А105» станет «А305».
 * Подвалы и цоколь номеров «по этажу» обычно не носят — с ними номера не трогаем.
 */
export function levelRenumber(
  fromLevel: number,
  toLevel: number,
): { from: string; to: string } | undefined {
  if (fromLevel <= 0 || toLevel <= 0 || fromLevel === toLevel) return undefined
  return { from: String(fromLevel), to: String(toLevel) }
}

function renumber(number: string, { from, to }: { from: string; to: string }): string {
  const m = /^(\D*)(\d.*)$/.exec(number)
  if (!m) return number
  const [, prefix = '', digits = ''] = m
  return digits.startsWith(from) ? prefix + to + digits.slice(from.length) : number
}

export type BuildingShape = 'rect' | 'L' | 'U' | 'T'

/**
 * Контур корпуса по шаблону и размерам (мм): прямоугольник, Г-, П- и Т-образный. Крыло —
 * ширины `wingMm`. Нужен форме «Добавить корпус»: нарисовать контур на территории можно и
 * руками, но типовые корпуса быстрее задать размерами.
 */
export function outlineFromShape(
  shape: BuildingShape,
  widthMm: number,
  depthMm: number,
  wingMm: number,
): Pt[] {
  const w = widthMm
  const d = depthMm
  const k = Math.min(wingMm, Math.floor(w / 2) - 1, Math.floor(d / 2) - 1)
  switch (shape) {
    case 'L':
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: k },
        { x: k, y: k },
        { x: k, y: d },
        { x: 0, y: d },
      ]
    case 'U':
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: d },
        { x: w - k, y: d },
        { x: w - k, y: k },
        { x: k, y: k },
        { x: k, y: d },
        { x: 0, y: d },
      ]
    case 'T': {
      const left = Math.round((w - k) / 2)
      return [
        { x: 0, y: d - k },
        { x: left, y: d - k },
        { x: left, y: 0 },
        { x: left + k, y: 0 },
        { x: left + k, y: d - k },
        { x: w, y: d - k },
        { x: w, y: d },
        { x: 0, y: d },
      ]
    }
    default:
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: d },
        { x: 0, y: d },
      ]
  }
}
