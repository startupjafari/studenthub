import {
  centerPath,
  decodeFlags,
  nodePoint,
  toBuilding,
  type BuildingTransform,
  type CenterWall,
  type NavEdgeKind,
  type NavGraph,
  type NavIndex,
  type Pt,
  type RouteResult,
} from '@studenthub/campus-core'

/** Точка маршрута для интерфейса: помещение на этаже с подписью. */
export interface Place {
  spaceId: string
  floorId: string
  buildingId: string
  label: string
}

/**
 * Участки маршрута на одном этаже — ломаные в координатах корпуса (холст рисует план корпуса).
 * Маршрут уходит с этажа по лестнице и может вернуться — тогда участков несколько.
 */
export function routeOnFloor(
  graph: NavGraph,
  route: RouteResult,
  floorId: string,
  transform: BuildingTransform,
): Pt[][] {
  const lines: Pt[][] = []
  let cur: Pt[] | null = null
  for (const n of route.nodes) {
    const p = nodePoint(graph, n)
    if (p.floor === floorId) {
      if (!cur) {
        cur = []
        lines.push(cur)
      }
      cur.push(toBuilding({ x: p.x, y: p.y }, transform))
    } else {
      cur = null
    }
  }
  return lines.filter((l) => l.length > 1)
}

/** Тип ребра a→b (самого лёгкого, если их несколько). */
function edgeKind(index: NavIndex, a: number, b: number): NavEdgeKind {
  const list = index.adj[a] ?? []
  let best: { w: number; f: number } | null = null
  for (let k = 0; k < list.length; k += 3) {
    if (list[k] === b && (!best || list[k + 1]! < best.w))
      best = { w: list[k + 1]!, f: list[k + 2]! }
  }
  return best ? decodeFlags(best.f).kind : 'walk'
}

/** Точка маршрута в мм кампуса: высота, этаж (на улице — null) и чем к ней пришли. */
export interface RoutePoint {
  x: number
  y: number
  z: number
  floor: string | null
  via: NavEdgeKind | null
}

/**
 * Геометрия маршрута: узлы графа, а участки по этажу — по оси проходов (`centerPath`):
 * кратчайший путь графа прижимается к стенам. Двери, площадки лестниц и лифтов, входы и
 * метки помещений остаются на месте. Стен этажа ещё нет (план не загружен) — участок как в
 * графе. Одна геометрия для линии на плане, булавок и 3D: линия и камера не расходятся.
 */
export function routeGeometry(
  index: NavIndex,
  route: RouteResult,
  walls: ReadonlyMap<string, CenterWall[]>,
): RoutePoint[] {
  const raw: RoutePoint[] = route.nodes.map((n, i) => {
    const p = nodePoint(index.graph, n)
    return {
      x: p.x,
      y: p.y,
      z: p.z,
      floor: p.floor ?? null,
      via: i > 0 ? edgeKind(index, route.nodes[i - 1]!, n) : null,
    }
  })
  const out: RoutePoint[] = []
  const push = (p: RoutePoint): void => {
    if (out.at(-1) !== p) out.push(p)
  }
  let i = 0
  while (i < raw.length) {
    const head = raw[i]!
    const w = head.floor ? walls.get(head.floor) : undefined
    // Участок: подряд идущие рёбра «пешком» по тому же этажу.
    let j = i
    while (
      w &&
      j + 1 < raw.length &&
      raw[j + 1]!.via === 'walk' &&
      raw[j + 1]!.floor === head.floor &&
      raw[j + 1]!.z === head.z
    )
      j++
    push(head)
    if (j === i) {
      i++
      continue
    }
    const centered = centerPath(
      raw.slice(i, j + 1).map(({ x, y }) => ({ x, y })),
      w!,
    )
    for (const q of centered.slice(1, -1)) push({ ...head, x: q.x, y: q.y, via: 'walk' })
    push(raw[j]!)
    i = j
    if (i === raw.length - 1) break
  }
  return out
}

/**
 * Маршрут в метрах сцены three: (x, высота, −y), этаж точки и чем к ней пришли (`via`):
 * сцена разворачивает лестницу в марш, а лифт — в поездку в кабине.
 */
export function routeInScene(
  points: readonly RoutePoint[],
): { x: number; y: number; z: number; floor: string | null; via: NavEdgeKind | null }[] {
  return points.map((p) => ({
    x: p.x / 1000,
    y: p.z / 1000,
    z: -p.y / 1000,
    floor: p.floor,
    via: p.via,
  }))
}

/** Первый этаж маршрута (старт у ворот — на улице, тогда этаж входа). */
export function routeStartFloor(graph: NavGraph, route: RouteResult): string | null {
  for (const n of route.nodes) {
    const f = nodePoint(graph, n).floor
    if (f) return f
  }
  return null
}

/**
 * Этаж каждой точки маршрута для карты уровня. Улица своего этажа не имеет — её показываем
 * на уровне, где из корпуса вышли (или куда войдут, если путь начался у ворот): иначе на
 * плане вместо пути между корпусами был бы разрыв.
 */
function levelFloors(points: readonly RoutePoint[]): (string | null)[] {
  const own = points.map((p) => p.floor)
  const out = [...own]
  let last: string | null = null
  for (let i = 0; i < own.length; i++) {
    if (own[i]) last = own[i]!
    else out[i] = last
  }
  let next: string | null = null
  for (let i = own.length - 1; i >= 0; i--) {
    if (own[i]) next = own[i]!
    else if (!out[i]) out[i] = next
  }
  return out
}

/**
 * Участки маршрута на уровне — по всем этажам этого уровня сразу (карта показывает все
 * корпуса уровня) и улица между ними, в мм кампуса.
 */
export function routeOnLevel(points: readonly RoutePoint[], floorIds: Set<string>): Pt[][] {
  const floors = levelFloors(points)
  const lines: Pt[][] = []
  let cur: Pt[] | null = null
  points.forEach((p, i) => {
    const f = floors[i]
    if (f && floorIds.has(f)) {
      if (!cur) {
        cur = []
        lines.push(cur)
      }
      cur.push({ x: p.x, y: p.y })
    } else {
      cur = null
    }
  })
  return lines.filter((l) => l.length > 1)
}

/** Начало и конец маршрута, если они на этом уровне (для булавок А и Б). */
export function routeEndsOnLevel(
  points: readonly RoutePoint[],
  floorIds: Set<string>,
): { a: Pt | null; b: Pt | null } {
  const floors = levelFloors(points)
  const at = (i: number): Pt | null => {
    const f = floors[i]
    const p = points[i]
    if (!f || !p || !floorIds.has(f)) return null
    return { x: p.x, y: p.y }
  }
  return { a: at(0), b: at(points.length - 1) }
}

/** Этаж маршрута на самом высоком уровне: выше него в проходе показывать нечего. */
export function routeTopFloor(
  graph: NavGraph,
  route: RouteResult,
  floors: Map<string, { floor: { level: number } }>,
): string | null {
  let best: { id: string; level: number } | null = null
  for (const n of route.nodes) {
    const id = nodePoint(graph, n).floor
    const level = id ? floors.get(id)?.floor.level : undefined
    if (id && level !== undefined && (!best || level > best.level)) best = { id, level }
  }
  return best?.id ?? null
}
