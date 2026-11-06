import type { FloorPlanDoc, PlanOpening, PlanWall } from '../format/schema.js'
import { randomIds, type IdGen, type IdKind } from '../format/ids.js'
import { distance, insideSegment, segmentContact, type Pt } from '../geom/int.js'

/**
 * Правки графа стен с сохранением инварианта планарности (docs/CAMPUS_BUILDER.md §11.3):
 * стены касаются друг друга только в общих узлах. Пересечение крест-накрест, Т-примыкание и
 * наложение на одной прямой расщепляют стены в точках контакта; совпавшие стены сливаются.
 *
 * Документ на входе не меняется: операция работает на черновике со структурным разделением
 * (копируются только словари и затронутые объекты) и возвращает новый документ.
 */
export interface WallSpec {
  thicknessMm: number
  kind: PlanWall['kind']
  heightMm?: number
}

export interface EditResult {
  doc: FloorPlanDoc
  /**
   * Происхождение новых стен: id новой → id стены исходного документа, от которой она
   * отделилась при расщеплении. По нему помещения узнают свои рёбра (match-spaces).
   */
  lineage: Record<string, string>
  /** Стены, которых не было в исходном документе. */
  created: string[]
}

// Предохранитель от зацикливания: округление точки пересечения до мм теоретически может
// породить новые касания. Реальные планы сходятся за единицы проходов на стену.
const MAX_STEPS_PER_WALL = 64

class Draft {
  nodes: FloorPlanDoc['nodes']
  walls: FloorPlanDoc['walls']
  openings: FloorPlanDoc['openings']
  readonly lineage: Record<string, string> = {}
  private readonly byPoint = new Map<string, string>()

  constructor(
    private readonly source: FloorPlanDoc,
    private readonly ids: IdGen,
  ) {
    this.nodes = { ...source.nodes }
    this.walls = { ...source.walls }
    this.openings = { ...source.openings }
    for (const [id, n] of Object.entries(this.nodes)) this.byPoint.set(key(n), id)
  }

  point(id: string): Pt {
    const n = this.nodes[id]
    if (!n) throw new Error(`Узел ${id} не найден`)
    return n
  }

  fresh(kind: IdKind): string {
    const taken = kind === 'n' ? this.nodes : kind === 'w' ? this.walls : this.openings
    for (;;) {
      const id = this.ids(kind)
      if (!(id in taken)) return id
    }
  }

  /** Узел в точке: существующий (в точке не бывает двух узлов) или новый. */
  nodeAt(p: Pt): string {
    const existing = this.byPoint.get(key(p))
    if (existing) return existing
    const id = this.fresh('n')
    this.nodes[id] = { x: p.x, y: p.y }
    this.byPoint.set(key(p), id)
    return id
  }

  setNode(id: string, p: Pt): void {
    const old = this.nodes[id]
    if (old && this.byPoint.get(key(old)) === id) this.byPoint.delete(key(old))
    this.nodes[id] = { x: p.x, y: p.y }
    this.byPoint.set(key(p), id)
  }

  deleteNode(id: string): void {
    const n = this.nodes[id]
    if (n && this.byPoint.get(key(n)) === id) this.byPoint.delete(key(n))
    delete this.nodes[id]
  }

  nodeIdAt(p: Pt): string | undefined {
    return this.byPoint.get(key(p))
  }

  wallLength(wall: PlanWall): number {
    return distance(this.point(wall.a), this.point(wall.b))
  }

  /** Корень происхождения стены — id из исходного документа. */
  private root(wallId: string): string {
    return this.lineage[wallId] ?? wallId
  }

  /**
   * Делит стену в точке p (строго внутри): часть a→p сохраняет id, часть p→b — новая.
   * Проём остаётся на той части, где лежит его середина; смещение пересчитывается.
   */
  splitWall(wallId: string, p: Pt): [string, string] {
    const wall = this.walls[wallId]
    if (!wall) throw new Error(`Стена ${wallId} не найдена`)
    const mid = this.nodeAt(p)
    const firstLength = distance(this.point(wall.a), p)
    const second = this.fresh('w')
    this.walls[wallId] = { ...wall, b: mid }
    this.walls[second] = { ...wall, a: mid }
    this.lineage[second] = this.root(wallId)
    for (const [oid, o] of Object.entries(this.openings)) {
      if (o.wallId !== wallId) continue
      if (o.offsetMm + o.widthMm / 2 > firstLength) {
        this.openings[oid] = {
          ...o,
          wallId: second,
          offsetMm: Math.max(0, Math.round(o.offsetMm - firstLength)),
        }
      }
    }
    return [wallId, second]
  }

  /** Удаляет стену; её проёмы «паркуются» (wallId: null) с сохранением атрибутов. */
  removeWall(wallId: string): void {
    delete this.walls[wallId]
    for (const [oid, o] of Object.entries(this.openings)) {
      if (o.wallId === wallId) this.openings[oid] = { ...o, wallId: null }
    }
  }

  /** Сливает дубликат `drop` в стену `keep` (одна пара узлов): проёмы переезжают. */
  mergeDuplicate(drop: string, keep: string): void {
    const d = this.walls[drop]
    const k = this.walls[keep]
    if (!d || !k) return
    const reversed = d.a !== k.a
    const length = this.wallLength(k)
    for (const [oid, o] of Object.entries(this.openings)) {
      if (o.wallId !== drop) continue
      const offsetMm = reversed
        ? Math.max(0, Math.round(length - o.offsetMm - o.widthMm))
        : o.offsetMm
      this.openings[oid] = { ...o, wallId: keep, offsetMm } as PlanOpening
    }
    delete this.walls[drop]
  }

  /**
   * Восстановление планарности вокруг затронутых стен. Каждая стена из очереди сверяется со
   * всеми (с отсечением по габариту); на контакте — расщепление, и обе половины снова идут в
   * очередь. O(затронутые × все) — на этаже в тысячи стен это миллисекунды; пространственный
   * индекс появится вместе с холстом (задача 22.8).
   */
  planarize(queue: string[]): void {
    const pending = [...queue]
    const steps = new Map<string, number>()
    while (pending.length > 0) {
      const wid = pending.pop()!
      const w = this.walls[wid]
      if (!w) continue
      const count = (steps.get(wid) ?? 0) + 1
      steps.set(wid, count)
      if (count > MAX_STEPS_PER_WALL) continue
      if (w.a === w.b) {
        this.removeWall(wid)
        continue
      }
      const a = this.point(w.a)
      const b = this.point(w.b)
      const loX = Math.min(a.x, b.x)
      const hiX = Math.max(a.x, b.x)
      const loY = Math.min(a.y, b.y)
      const hiY = Math.max(a.y, b.y)
      let changed = false
      for (const [oid, o] of Object.entries(this.walls)) {
        if (oid === wid) continue
        const c = this.point(o.a)
        const d = this.point(o.b)
        if (Math.max(c.x, d.x) < loX || Math.min(c.x, d.x) > hiX) continue
        if (Math.max(c.y, d.y) < loY || Math.min(c.y, d.y) > hiY) continue
        const contact = segmentContact(a, b, c, d)
        if (contact.kind === 'none') continue
        const points = contact.kind === 'point' ? [contact.p] : contact.points
        const cutOther = points.find((p) => insideSegment(p, c, d))
        if (cutOther) {
          pending.push(...this.splitWall(oid, cutOther))
          changed = true
          break
        }
        const cutSelf = points.find((p) => insideSegment(p, a, b))
        if (cutSelf) {
          pending.push(...this.splitWall(wid, cutSelf))
          changed = true
          break
        }
        // Контакт только концами. Наложение без внутренних точек — та же пара узлов: дубль.
        if (contact.kind === 'overlap') {
          this.mergeDuplicate(wid, oid)
          changed = true
          break
        }
      }
      if (changed && this.walls[wid]) pending.push(wid)
    }
  }

  /** Узлы без стен убираются: узел существует только как конец стены. */
  dropOrphanNodes(): void {
    const used = new Set<string>()
    for (const w of Object.values(this.walls)) {
      used.add(w.a)
      used.add(w.b)
    }
    for (const id of Object.keys(this.nodes)) if (!used.has(id)) this.deleteNode(id)
  }

  result(): EditResult {
    this.dropOrphanNodes()
    const created = Object.keys(this.walls).filter((id) => !(id in this.source.walls))
    return {
      doc: { ...this.source, nodes: this.nodes, walls: this.walls, openings: this.openings },
      lineage: this.lineage,
      created,
    }
  }
}

function key(p: Pt): string {
  return `${p.x},${p.y}`
}

/**
 * Новая стена от p до q. Концы прилипают к узлам в тех же точках; пересечённые стены
 * расщепляются, и сама новая стена режется на участки между точками контакта. Повторное
 * рисование уже существующей стены ничего не меняет. p = q — без изменений.
 */
export function addWall(
  doc: FloorPlanDoc,
  p: Pt,
  q: Pt,
  spec: WallSpec,
  ids: IdGen = randomIds,
): EditResult {
  const draft = new Draft(doc, ids)
  if (p.x === q.x && p.y === q.y) return draft.result()
  const a = draft.nodeAt(p)
  const b = draft.nodeAt(q)
  const id = draft.fresh('w')
  draft.walls[id] = { a, b, ...spec }
  draft.planarize([id])
  return draft.result()
}

/**
 * Перенос узла. Совпал с другим узлом — узлы сливаются (их стены теперь общие, стена между
 * ними исчезает). Стены, задевшие новые соседние, расщепляются.
 */
export function moveNode(
  doc: FloorPlanDoc,
  nodeId: string,
  to: Pt,
  ids: IdGen = randomIds,
): EditResult {
  const draft = new Draft(doc, ids)
  if (!draft.nodes[nodeId]) throw new Error(`Узел ${nodeId} не найден`)
  const target = draft.nodeIdAt(to)
  let moved = nodeId
  if (target && target !== nodeId) {
    for (const [wid, w] of Object.entries(draft.walls)) {
      if (w.a === nodeId || w.b === nodeId) {
        draft.walls[wid] = {
          ...w,
          a: w.a === nodeId ? target : w.a,
          b: w.b === nodeId ? target : w.b,
        }
      }
    }
    draft.deleteNode(nodeId)
    moved = target
  } else {
    draft.setNode(nodeId, to)
  }
  const touched = Object.entries(draft.walls)
    .filter(([, w]) => w.a === moved || w.b === moved)
    .map(([id]) => id)
  draft.planarize(touched)
  return draft.result()
}

/** Удаление стены. Проёмы паркуются, узлы без стен исчезают. */
export function removeWall(doc: FloorPlanDoc, wallId: string, ids: IdGen = randomIds): EditResult {
  const draft = new Draft(doc, ids)
  if (draft.walls[wallId]) draft.removeWall(wallId)
  return draft.result()
}

/** Длина стены по документу, мм (дробная). */
export function wallLength(doc: FloorPlanDoc, wallId: string): number {
  const w = doc.walls[wallId]
  if (!w) return 0
  const a = doc.nodes[w.a]
  const b = doc.nodes[w.b]
  return a && b ? distance(a, b) : 0
}
