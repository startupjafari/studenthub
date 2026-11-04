import {
  decodeFlags,
  edgeFlags,
  NAV_NODE_KINDS,
  type NavEdgeKind,
  type NavGraph,
  type NavNodeKind,
} from './graph.js'

/**
 * Поиск маршрута по навигационному графу (§15.4–15.6): A* с эвристикой «расстояние по прямой
 * в 3D» — она допустима, потому что вес лестницы и лифта не меньше разницы высот. Считается
 * на клиенте: сервер маршруты не строит, дорогих эндпоинтов нет.
 */
export interface RouteProfile {
  /** Только без ступеней: лифты и пандусы. */
  stepFree?: boolean
  /** Служебные двери доступны (сотрудник). Закрытые — никогда. */
  staff?: boolean
}

export interface RouteResult {
  nodes: number[]
  /** Сумма длин рёбер, мм (без штрафов — для подписи «≈ N м»). */
  distanceMm: number
  /** Вес пути с учётом лестниц и лифтов. */
  cost: number
}

export interface NavIndex {
  graph: NavGraph
  /** Смежность: для узла — список [сосед, вес, флаги]. */
  adj: number[][]
  /** Помещение → узел-назначение. */
  nodeBySpace: Map<string, number>
}

export function indexGraph(graph: NavGraph): NavIndex {
  const n = graph.nodes.length / 5
  const adj: number[][] = Array.from({ length: n }, () => [])
  const e = graph.edges
  for (let i = 0; i < e.length; i += 4) {
    const a = e[i]!
    const b = e[i + 1]!
    adj[a]!.push(b, e[i + 2]!, e[i + 3]!)
    adj[b]!.push(a, e[i + 2]!, e[i + 3]!)
  }
  const nodeBySpace = new Map<string, number>()
  for (const [node, space] of Object.entries(graph.spaces)) nodeBySpace.set(space, Number(node))
  return { graph, adj, nodeBySpace }
}

export function nodePoint(
  graph: NavGraph,
  i: number,
): { x: number; y: number; z: number; floor: string | null; kind: NavNodeKind } {
  const o = i * 5
  const fi = graph.nodes[o + 3]!
  return {
    x: graph.nodes[o]!,
    y: graph.nodes[o + 1]!,
    z: graph.nodes[o + 2]!,
    floor: fi >= 0 ? (graph.floors[fi] ?? null) : null,
    kind: NAV_NODE_KINDS[graph.nodes[o + 4]!] ?? 'waypoint',
  }
}

function allowed(
  flags: number,
  profile: RouteProfile,
  ignore: { access?: boolean; stepFree?: boolean } = {},
): boolean {
  const f = decodeFlags(flags)
  if (f.access === 'closed' && !ignore.access) return false
  if (f.access === 'staff' && !profile.staff && !ignore.access) return false
  if (profile.stepFree && !f.stepFree && !ignore.stepFree) return false
  return true
}

/** Двоичная куча по приоритету — A* на тысячах узлов без сортировок. */
class Heap {
  private readonly items: number[] = []
  private readonly prio: number[] = []

  get size(): number {
    return this.items.length
  }

  push(item: number, p: number): void {
    this.items.push(item)
    this.prio.push(p)
    let i = this.items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.prio[parent]! <= this.prio[i]!) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop(): number {
    const top = this.items[0]!
    const lastItem = this.items.pop()!
    const lastPrio = this.prio.pop()!
    if (this.items.length > 0) {
      this.items[0] = lastItem
      this.prio[0] = lastPrio
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < this.items.length && this.prio[l]! < this.prio[m]!) m = l
        if (r < this.items.length && this.prio[r]! < this.prio[m]!) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }

  private swap(a: number, b: number): void {
    ;[this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!]
    ;[this.prio[a], this.prio[b]] = [this.prio[b]!, this.prio[a]!]
  }
}

export function findRoute(
  index: NavIndex,
  from: number,
  to: number,
  profile: RouteProfile = {},
  ignore: { access?: boolean; stepFree?: boolean } = {},
): RouteResult | null {
  const { graph, adj } = index
  const n = adj.length
  if (from < 0 || to < 0 || from >= n || to >= n) return null
  const target = nodePoint(graph, to)
  const h = (i: number): number => {
    const p = nodePoint(graph, i)
    return Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z)
  }
  const g = new Float64Array(n).fill(Infinity)
  const prev = new Int32Array(n).fill(-1)
  const done = new Uint8Array(n)
  const heap = new Heap()
  g[from] = 0
  heap.push(from, h(from))
  while (heap.size > 0) {
    const u = heap.pop()
    if (done[u]) continue
    done[u] = 1
    if (u === to) break
    const list = adj[u]!
    for (let k = 0; k < list.length; k += 3) {
      const v = list[k]!
      if (done[v] || !allowed(list[k + 2]!, profile, ignore)) continue
      const cand = g[u]! + list[k + 1]!
      if (cand < g[v]!) {
        g[v] = cand
        prev[v] = u
        heap.push(v, cand + h(v))
      }
    }
  }
  if (!Number.isFinite(g[to]!)) return null
  const nodes: number[] = []
  for (let i = to; i !== -1; i = prev[i]!) nodes.push(i)
  nodes.reverse()
  let distanceMm = 0
  for (let i = 1; i < nodes.length; i++) {
    const a = nodePoint(graph, nodes[i - 1]!)
    const b = nodePoint(graph, nodes[i]!)
    distanceMm += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return { nodes, distanceMm, cost: g[to]! }
}

/** Маршрут между помещениями; null — не нашёлся (причина — `explainNoRoute`). */
export function routeBetweenSpaces(
  index: NavIndex,
  fromSpace: string,
  toSpace: string,
  profile: RouteProfile = {},
): RouteResult | null {
  const a = index.nodeBySpace.get(fromSpace)
  const b = index.nodeBySpace.get(toSpace)
  if (a === undefined || b === undefined) return null
  return findRoute(index, a, b, profile)
}

export type NoRouteReason =
  | 'NO_GRAPH'
  | 'UNKNOWN_SPACE'
  | 'NO_DOOR'
  | 'FLOORS_NOT_CONNECTED'
  | 'NO_ENTRANCE'
  | 'ISOLATED'
  | 'ACCESS_RESTRICTED'
  | 'STEP_FREE_UNAVAILABLE'

/** Связная компонента узла без учёта ограничений профиля. */
function component(index: NavIndex, start: number): Set<number> {
  const seen = new Set<number>([start])
  const stack = [start]
  while (stack.length) {
    const u = stack.pop()!
    const list = index.adj[u]!
    for (let k = 0; k < list.length; k += 3) {
      const v = list[k]!
      if (!seen.has(v)) {
        seen.add(v)
        stack.push(v)
      }
    }
  }
  return seen
}

/**
 * Почему маршрута нет (§15.6): от «ничего не мешает, кроме профиля» к «геометрия не
 * связана». Зритель получает понятную причину, а редактор — что чинить.
 */
export function explainNoRoute(
  index: NavIndex | null,
  fromSpace: string,
  toSpace: string,
  profile: RouteProfile = {},
): NoRouteReason | null {
  if (!index) return 'NO_GRAPH'
  const a = index.nodeBySpace.get(fromSpace)
  const b = index.nodeBySpace.get(toSpace)
  if (a === undefined || b === undefined) return 'UNKNOWN_SPACE'
  if (findRoute(index, a, b, profile)) return null
  const doorless = (node: number): boolean => {
    // Из компоненты помещения нет ни одного ребра-перехода: ни двери, ни лестницы, ни улицы —
    // только ходьба внутри одной грани.
    for (const u of component(index, node)) {
      const list = index.adj[u]!
      for (let k = 2; k < list.length; k += 3)
        if (decodeFlags(list[k]!).kind !== 'walk') return false
    }
    return true
  }
  if (doorless(b) || doorless(a)) return 'NO_DOOR'
  if (findRoute(index, a, b, { ...profile, stepFree: false })) return 'STEP_FREE_UNAVAILABLE'
  if (findRoute(index, a, b, profile, { access: true })) return 'ACCESS_RESTRICTED'
  const pa = nodePoint(index.graph, a)
  const pb = nodePoint(index.graph, b)
  const compA = component(index, a)
  if (pa.floor !== pb.floor) {
    const sameBuildingFloors = [...compA].some((v) => nodePoint(index.graph, v).kind === 'landing')
    const hasEntrance = [...compA].some((v) => nodePoint(index.graph, v).kind === 'entrance')
    if (!sameBuildingFloors && !hasEntrance) return 'FLOORS_NOT_CONNECTED'
    if (!hasEntrance) return 'NO_ENTRANCE'
  }
  return 'ISOLATED'
}

export type RouteStep =
  | { type: 'start'; spaceId: string | null }
  | {
      type: 'vertical'
      via: Extract<NavEdgeKind, 'stairs' | 'elevator' | 'ramp'>
      toFloor: string | null
      up: boolean
    }
  | { type: 'exit'; fromFloor: string | null }
  | { type: 'enter'; toFloor: string | null }
  | { type: 'arrive'; spaceId: string | null; distanceMm: number }

/**
 * Шаги маршрута для списка «Как пройти»: смена этажа, выход на улицу и вход в корпус.
 * Повороты не описываем: линия на плане понятнее «через 12 м налево».
 */
export function routeSteps(index: NavIndex, route: RouteResult): RouteStep[] {
  const { graph } = index
  const steps: RouteStep[] = [{ type: 'start', spaceId: graph.spaces[route.nodes[0]!] ?? null }]
  const edgeKind = (a: number, b: number): NavEdgeKind => {
    const list = index.adj[a]!
    let best: { w: number; f: number } | null = null
    for (let k = 0; k < list.length; k += 3) {
      if (list[k] === b && (!best || list[k + 1]! < best.w))
        best = { w: list[k + 1]!, f: list[k + 2]! }
    }
    return best ? decodeFlags(best.f).kind : 'walk'
  }
  let outside = false
  for (let i = 1; i < route.nodes.length; i++) {
    const a = route.nodes[i - 1]!
    const b = route.nodes[i]!
    const kind = edgeKind(a, b)
    const pa = nodePoint(graph, a)
    const pb = nodePoint(graph, b)
    if (kind === 'stairs' || kind === 'elevator' || kind === 'ramp') {
      const last = steps.at(-1)
      // Подряд идущие пролёты одной лестницы — один шаг «на N этаж».
      if (last?.type === 'vertical' && last.via === kind) {
        last.toFloor = pb.floor
      } else {
        steps.push({ type: 'vertical', via: kind, toFloor: pb.floor, up: pb.z > pa.z })
      }
    } else if (kind === 'outdoor' && !outside) {
      outside = true
      steps.push({ type: 'exit', fromFloor: pa.floor })
    } else if (outside && kind !== 'outdoor') {
      outside = false
      steps.push({ type: 'enter', toFloor: pb.floor })
    }
  }
  steps.push({
    type: 'arrive',
    spaceId: graph.spaces[route.nodes.at(-1)!] ?? null,
    distanceMm: route.distanceMm,
  })
  return steps
}

/**
 * Граф под уровень зрителя: обычному зрителю служебные двери закрыты (как и на его плане —
 * `floorForViewer`), а помещения, которых он не видит, перестают быть адресами; проход через
 * их грань остаётся, иначе путь исказился бы. Закрытые рёбра не удаляются: по ним
 * `explainNoRoute` отличает «доступ ограничен» от «не связано».
 */
export function graphForViewer(
  graph: NavGraph,
  visibleSpaces: ReadonlySet<string>,
  staff: boolean,
): NavGraph {
  const edges = graph.edges.slice()
  if (!staff) {
    for (let i = 3; i < edges.length; i += 4) {
      const f = decodeFlags(edges[i]!)
      if (f.access === 'staff') edges[i] = edgeFlags(f.kind, f.stepFree, 'closed')
    }
  }
  const spaces: Record<string, string> = {}
  for (const [node, space] of Object.entries(graph.spaces))
    if (visibleSpaces.has(space)) spaces[node] = space
  return { ...graph, edges, spaces }
}
