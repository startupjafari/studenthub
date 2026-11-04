import type { FloorPlanDoc, PlanSpace } from '../format/schema.js'
import { interiorPoint } from '../geom/polygon.js'
import { buildFaces, faceContains, type Face } from './faces.js'

/**
 * Устойчивая идентичность помещений (docs/CAMPUS_BUILDER.md §11.5).
 *
 * Порядок обхода граней меняется при любой правке, поэтому id помещения хранится в документе,
 * а грань ему подбирается заново:
 *   1) по общим стенам — с учётом происхождения: половина расщеплённой стены считается той
 *      же стеной (`lineage` из операции правки);
 *   2) по метке — грань, внутри которой лежит `space.label`;
 *   3) при равенстве — помещение с большим числом стен (обычно это большее помещение: при
 *      слиянии двух комнат id остаётся у большей).
 * Назначение жадное и однозначное: одна грань — одно помещение. Номер и связь с `Room` молча
 * не переходят на чужую грань: не нашлось грани — помещение «потеряно», решает человек.
 */
export interface MatchResult {
  doc: FloorPlanDoc
  /** Помещение → грань, которую оно заняло. */
  assignments: Record<string, string>
  /** Помещения без грани: стены разобрали. Атрибуты сохранены, публикация заблокирована. */
  lost: string[]
  /** Замкнутые области без помещения — кандидаты «Создать помещение». */
  unassignedFaces: string[]
}

interface Candidate {
  spaceId: string
  faceId: string
  shared: number
  labelInside: boolean
  edgeCount: number
}

export function matchSpaces(
  doc: FloorPlanDoc,
  lineage: Record<string, string> = {},
  faces: Face[] = buildFaces(doc).faces,
): MatchResult {
  const faceById = new Map(faces.map((f) => [f.id, f]))
  // Стены грани вместе с их «предками»: помещение помнит рёбра до расщепления.
  const faceWalls = new Map(
    faces.map((f) => [f.id, new Set(f.wallIds.flatMap((w) => [w, lineage[w] ?? w]))]),
  )

  // Кандидаты без перебора «все помещения × все грани»: по общим стенам — через индекс
  // «стена → грани», по метке — только грани, чей габарит её накрывает. На этаже в 500
  // помещений это разница между десятками миллисекунд и единицами.
  const facesByWall = new Map<string, Face[]>()
  for (const face of faces) {
    for (const w of faceWalls.get(face.id)!) {
      const list = facesByWall.get(w)
      if (list) list.push(face)
      else facesByWall.set(w, [face])
    }
  }
  const boxes = new Map(
    faces.map((f) => {
      const xs = f.outer.points.map((p) => p.x)
      const ys = f.outer.points.map((p) => p.y)
      return [
        f.id,
        { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) },
      ]
    }),
  )

  const candidates: Candidate[] = []
  for (const [spaceId, space] of Object.entries(doc.spaces)) {
    const near = new Set<Face>()
    for (const e of space.edges) for (const f of facesByWall.get(e) ?? []) near.add(f)
    for (const f of faces) {
      const b = boxes.get(f.id)!
      if (
        space.label.x > b.x0 &&
        space.label.x < b.x1 &&
        space.label.y > b.y0 &&
        space.label.y < b.y1
      )
        near.add(f)
    }
    for (const face of near) {
      const walls = faceWalls.get(face.id)!
      const shared = space.edges.reduce((n, e) => n + (walls.has(e) ? 1 : 0), 0)
      const labelInside = faceContains(face, space.label)
      if (shared === 0 && !labelInside) continue
      candidates.push({
        spaceId,
        faceId: face.id,
        shared,
        labelInside,
        edgeCount: space.edges.length,
      })
    }
  }
  candidates.sort(
    (a, b) =>
      b.shared - a.shared ||
      Number(b.labelInside) - Number(a.labelInside) ||
      b.edgeCount - a.edgeCount ||
      a.spaceId.localeCompare(b.spaceId),
  )

  const assignments: Record<string, string> = {}
  const taken = new Set<string>()
  for (const c of candidates) {
    if (c.spaceId in assignments || taken.has(c.faceId)) continue
    assignments[c.spaceId] = c.faceId
    taken.add(c.faceId)
  }

  const spaces: Record<string, PlanSpace> = { ...doc.spaces }
  for (const [spaceId, faceId] of Object.entries(assignments)) {
    const face = faceById.get(faceId)!
    const space = spaces[spaceId]!
    // Метка, выпавшая из своей грани (стену передвинули через неё), переезжает внутрь.
    const label = faceContains(face, space.label)
      ? space.label
      : (interiorPoint(
          face.outer.points,
          face.holes.filter((h) => h.points.length >= 3).map((h) => h.points),
        ) ?? space.label)
    spaces[spaceId] = { ...space, edges: [...face.wallIds], label }
  }

  return {
    doc: { ...doc, spaces },
    assignments,
    lost: Object.keys(doc.spaces).filter((id) => !(id in assignments)),
    unassignedFaces: faces.filter((f) => !taken.has(f.id)).map((f) => f.id),
  }
}
