import {
  nodePoint,
  toBuilding,
  type BuildingTransform,
  type NavGraph,
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

/** Маршрут в метрах сцены three: (x, высота, −y). */
export function routeInScene(
  graph: NavGraph,
  route: RouteResult,
): { x: number; y: number; z: number }[] {
  return route.nodes.map((n) => {
    const p = nodePoint(graph, n)
    return { x: p.x / 1000, y: p.z / 1000, z: -p.y / 1000 }
  })
}

/**
 * Участки маршрута на уровне — по всем этажам этого уровня сразу (карта показывает все
 * корпуса уровня), в мм кампуса.
 */
export function routeOnLevel(graph: NavGraph, route: RouteResult, floorIds: Set<string>): Pt[][] {
  const lines: Pt[][] = []
  let cur: Pt[] | null = null
  for (const n of route.nodes) {
    const p = nodePoint(graph, n)
    if (p.floor && floorIds.has(p.floor)) {
      if (!cur) {
        cur = []
        lines.push(cur)
      }
      cur.push({ x: p.x, y: p.y })
    } else {
      cur = null
    }
  }
  return lines.filter((l) => l.length > 1)
}
