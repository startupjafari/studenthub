import type { FloorPlanDoc } from '../format/schema.js'
import { randomIds, type IdGen } from '../format/ids.js'
import { addWall, type EditResult, type WallSpec } from './edit.js'
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
