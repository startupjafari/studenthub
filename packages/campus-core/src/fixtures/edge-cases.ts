import { emptyFloorPlan, type FloorPlanDoc, type PlanOpening } from '../format/schema.js'
import { sequentialIds, type IdGen } from '../format/ids.js'
import type { Pt } from '../geom/int.js'
import { addWall, type WallSpec } from '../topology/edit.js'

/**
 * Пограничные случаи тестового кампуса (docs/CAMPUS_BUILDER.md §22.1). Собираются теми же
 * операциями, что у редактора, — фикстура проверяет и сам результат, и путь к нему.
 * Генератор id последовательный: снимки фикстур детерминированы.
 */
export const WALL: WallSpec = { thicknessMm: 200, kind: 'wall' }

export class PlanBuilder {
  doc: FloorPlanDoc = emptyFloorPlan()
  readonly ids: IdGen = sequentialIds()

  wall(p: Pt, q: Pt, spec: WallSpec = WALL): this {
    this.doc = addWall(this.doc, p, q, spec, this.ids).doc
    return this
  }

  /** Замкнутая ломаная по точкам. */
  loop(points: Pt[], spec: WallSpec = WALL): this {
    points.forEach((p, i) => this.wall(p, points[(i + 1) % points.length]!, spec))
    return this
  }

  rect(x: number, y: number, w: number, h: number, spec: WallSpec = WALL): this {
    return this.loop(
      [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
      spec,
    )
  }

  /** Стена, проходящая через точки p→q (id первой части — для проёмов). */
  wallIdAt(p: Pt, q: Pt): string {
    for (const [id, w] of Object.entries(this.doc.walls)) {
      const a = this.doc.nodes[w.a]!
      const b = this.doc.nodes[w.b]!
      if (
        (a.x === p.x && a.y === p.y && b.x === q.x && b.y === q.y) ||
        (a.x === q.x && a.y === q.y && b.x === p.x && b.y === p.y)
      ) {
        return id
      }
    }
    throw new Error(`Нет стены ${p.x},${p.y} → ${q.x},${q.y}`)
  }

  opening(id: string, opening: PlanOpening): this {
    this.doc = { ...this.doc, openings: { ...this.doc.openings, [id]: opening } }
    return this
  }
}

const DOOR = { type: 'door', heightMm: 2100, swing: 'left-in', access: 'public' } as const

/** Каталог пограничных случаев. Каждый — отдельный документ. */
export function edgeCaseFixtures(): Record<string, FloorPlanDoc> {
  return {
    empty: new PlanBuilder().doc,
    singleWall: new PlanBuilder().wall({ x: 0, y: 0 }, { x: 5000, y: 0 }).doc,
    box: new PlanBuilder().rect(0, 0, 6000, 8000).doc,
    boxWithPartition: new PlanBuilder()
      .rect(0, 0, 12000, 8000)
      .wall({ x: 6000, y: 0 }, { x: 6000, y: 8000 }).doc,
    twoRoomsSharedWall: new PlanBuilder().rect(0, 0, 6000, 8000).rect(6000, 0, 6000, 8000).doc,
    roomInRoom: new PlanBuilder().rect(0, 0, 10000, 10000).rect(4000, 4000, 1000, 1000).doc,
    acuteAngles: new PlanBuilder().loop([
      { x: 0, y: 0 },
      { x: 10000, y: 0 },
      { x: 8660, y: 5000 }, // 30° у начала координат
    ]).doc,
    crossingWalls: new PlanBuilder()
      .wall({ x: 0, y: 5000 }, { x: 10000, y: 5000 })
      .wall({ x: 5000, y: 0 }, { x: 5000, y: 10000 }).doc,
    tJunction: new PlanBuilder()
      .wall({ x: 0, y: 0 }, { x: 10000, y: 0 })
      .wall({ x: 5000, y: 0 }, { x: 5000, y: 6000 }).doc,
    doorAtWallEdge: (() => {
      const b = new PlanBuilder().rect(0, 0, 6000, 8000)
      return b.opening('o1', {
        ...DOOR,
        wallId: b.wallIdAt({ x: 0, y: 0 }, { x: 6000, y: 0 }),
        offsetMm: 5100,
        widthMm: 900,
      }).doc
    })(),
    windowWiderThanWall: (() => {
      const b = new PlanBuilder().rect(0, 0, 3000, 3000)
      return b.opening('o1', {
        type: 'window',
        wallId: b.wallIdAt({ x: 0, y: 0 }, { x: 3000, y: 0 }),
        offsetMm: 500,
        widthMm: 3000,
        heightMm: 1500,
        sillMm: 900,
      }).doc
    })(),
    tinySpace: new PlanBuilder().rect(0, 0, 600, 600).doc,
  }
}
