import * as THREE from 'three'
import { toCampus, type PlanVertical } from '@studenthub/campus-core'
import { orientedBox, stairGeometry, type Pt3 } from '@studenthub/campus-core/mesh'
import type { SceneFloor } from './scene'

/** Точка маршрута сцены: метры, этаж и чем к ней пришли (тип ребра графа). */
export interface RoutePoint {
  x: number
  y: number
  z: number
  floor?: string | null
  via?: string | null
}

/** Лифт на маршруте: шахта (повёрнутый прямоугольник) и сторона двери — к площадке. */
export interface RouteElevator {
  /** Индекс точки в `pts`, с которой начинается поездка (площадка отправления). */
  at: number
  center: THREE.Vector3
  /** Оси шахты по земле: `door` — наружу через дверь, `side` — вдоль двери. */
  door: THREE.Vector3
  side: THREE.Vector3
  /** Полуразмеры шахты: вдоль двери и вглубь. */
  halfWidth: number
  halfDepth: number
  fromY: number
  toY: number
  buildingId: string
  toFloor: string | null
}

export interface RoutePath {
  pts: THREE.Vector3[]
  /** Отрезок i → i+1 — внутри лифтовой шахты (ленту там не рисуем). */
  inShaft: boolean[]
  elevators: RouteElevator[]
}

/** Скругление углов по земле, м: в пределах отступа узлов от стен (30 см) — угол не срезается. */
const CORNER_M = 0.3
const CORNER_STEPS = 4
/** Насколько далеко площадка графа может быть от площадки на плане, м. */
const LANDING_MATCH_M = 1.5

type Box = NonNullable<ReturnType<typeof orientedBox>>

/** Центр прямоугольника по осям `u`/`w`, в метрах сцены (y = 0). */
function boxCenter(box: Box): THREE.Vector3 {
  const sm = (box.s0 + box.s1) / 2
  const tm = (box.t0 + box.t1) / 2
  return new THREE.Vector3(box.u[0] * sm + box.w[0] * tm, 0, box.u[1] * sm + box.w[1] * tm)
}

/** Лестница или лифт этажа, чья площадка — в этой точке. */
function verticalAt(
  floor: SceneFloor | undefined,
  p: THREE.Vector3,
  types: readonly string[],
): { v: PlanVertical; box: Box; landing: Pt3 } | null {
  if (!floor) return null
  // Те же координаты, что у floorMesh: (x, −y) кампуса в метрах.
  const scene = (x: number, y: number): Pt3 => {
    const c = floor.transform ? toCampus({ x, y }, floor.transform) : { x, y }
    return [c.x / 1000, -c.y / 1000]
  }
  let best: { v: PlanVertical; box: Box; landing: Pt3; d: number } | null = null
  for (const v of Object.values(floor.doc.verticals)) {
    if (!types.includes(v.type)) continue
    const landing = scene(v.landing.x, v.landing.y)
    const d = Math.hypot(landing[0] - p.x, landing[1] - p.z)
    if (d > LANDING_MATCH_M || (best && d >= best.d)) continue
    const box = orientedBox(v.outline.map(([x, y]) => scene(x, y)))
    if (box) best = { v, box, landing, d }
  }
  return best
}

/**
 * Маршрут графа → путь для сцены. Граф соединяет площадки этажей прямым ребром, то есть
 * отвесно сквозь перекрытие; здесь лестница разворачивается в марш (как он нарисован в
 * floorMesh: от края у площадки вверх вдоль длинной стороны), а лифт остаётся отвесом
 * внутри шахты и запоминается для поездки в кабине. Углы по земле чуть скругляются.
 */
export function routePath(route: RoutePoint[], floors: readonly SceneFloor[]): RoutePath {
  const byId = new Map(floors.map((f) => [f.id, f]))
  // Узлы пути: точка, «следующий отрезок — в шахте» и лифт, если отсюда начинается поездка.
  const nodes: { p: THREE.Vector3; shaft: boolean; elevator?: Omit<RouteElevator, 'at'> }[] = []
  const push = (p: THREE.Vector3): void => {
    const last = nodes.at(-1)
    if (last && last.p.distanceToSquared(p) < 1e-6) return
    nodes.push({ p, shaft: false })
  }
  // Поездка 1 → 3 в графе — два ребра 1→2 и 2→3: это одна поездка, без остановки на 2.
  let riding: Omit<RouteElevator, 'at'> | null = null

  route.forEach((r, i) => {
    const p = new THREE.Vector3(r.x, r.y, r.z)
    const prev = i > 0 ? route[i - 1]! : null
    if (!prev || (r.via !== 'stairs' && r.via !== 'ramp' && r.via !== 'elevator')) {
      push(p)
      return
    }
    const a = new THREE.Vector3(prev.x, prev.y, prev.z)
    const up = p.y > a.y
    const low = up ? a : p
    const high = up ? p : a

    if (r.via === 'elevator') {
      const last = nodes.at(-1)
      if (riding && prev.via === 'elevator') {
        if (last) last.shaft = true
        riding.toY = p.y
        riding.toFloor = r.floor ?? null
        push(p)
        return
      }
      riding = null
      const found = verticalAt(byId.get(prev.floor ?? ''), a, ['elevator'])
      if (last) last.shaft = true
      if (last && found) {
        const { box, landing } = found
        const center = boxCenter(box)
        const u = new THREE.Vector3(box.u[0], 0, box.u[1])
        const w = new THREE.Vector3(box.w[0], 0, box.w[1])
        // Дверь — на той стороне шахты, что смотрит на площадку.
        const out = new THREE.Vector3(landing[0], 0, landing[1]).sub(center)
        const alongU = Math.abs(out.dot(u)) >= Math.abs(out.dot(w))
        const axis = alongU ? u : w
        const door = axis.clone().multiplyScalar(Math.sign(axis.dot(out)) || 1)
        const half = { u: (box.s1 - box.s0) / 2, w: (box.t1 - box.t0) / 2 }
        last.elevator = {
          center,
          door,
          side: new THREE.Vector3(-door.z, 0, door.x),
          halfWidth: alongU ? half.w : half.u,
          halfDepth: alongU ? half.u : half.w,
          fromY: a.y,
          toY: p.y,
          buildingId: byId.get(prev.floor ?? '')?.buildingId ?? '',
          toFloor: r.floor ?? null,
        }
        riding = last.elevator
      }
      push(p)
      return
    }

    // Лестница — по ступеням двухмаршевой лестницы, как её рисует floorMesh: от двери клетки
    // по этажной площадке, первый марш, промежуточная площадка, второй марш, снова к двери.
    const found = verticalAt(byId.get((up ? prev.floor : r.floor) ?? ''), low, [r.via])
    const rise = high.y - low.y
    if (!found || rise <= 0) {
      push(p)
      return
    }
    // Путь по ступеням считает сама лестница — тот же расчёт, что рисует её в 3D.
    const climb = stairGeometry(found.box, found.landing, rise).path.map(
      ({ p: [x, z], y }) => new THREE.Vector3(x, low.y + y, z),
    )
    const steps = up ? climb : climb.reverse()
    // Через несколько этажей подряд — не выходить на каждом транзитном этаже к двери клетки
    // и обратно: с марша на марш прямо по этажной площадке. Дверь и площадку этажа проходим
    // только там, где на лестницу вошли и где с неё сошли.
    const fromStairs = prev.via === r.via
    const toStairs = route[i + 1]?.via === r.via && route[i + 1]!.y > p.y === up
    for (const q of steps.slice(fromStairs ? 1 : 0, toStairs ? -1 : undefined)) push(q)
    if (!toStairs) push(p)
  })

  // Скругление по земле — только на горизонтальных стыках: марш, шахта и перепады высоты
  // остаются как есть, у площадок лифта узлы не трогаем.
  const out: typeof nodes = []
  nodes.forEach((n, i) => {
    const a = nodes[i - 1]
    const c = nodes[i + 1]
    const flat =
      a && c && Math.abs(a.p.y - n.p.y) < 0.01 && Math.abs(c.p.y - n.p.y) < 0.01 && !a.shaft
    const r = flat ? Math.min(CORNER_M, n.p.distanceTo(a.p) / 2, n.p.distanceTo(c.p) / 2) : 0
    if (!flat || n.shaft || n.elevator || r < 0.05) {
      out.push(n)
      return
    }
    const p0 = n.p.clone().addScaledVector(a.p.clone().sub(n.p).normalize(), r)
    const p1 = n.p.clone().addScaledVector(c.p.clone().sub(n.p).normalize(), r)
    for (let k = 0; k <= CORNER_STEPS; k++) {
      const t = k / CORNER_STEPS
      const u = 1 - t
      out.push({
        p: new THREE.Vector3()
          .addScaledVector(p0, u * u)
          .addScaledVector(n.p, 2 * u * t)
          .addScaledVector(p1, t * t),
        shaft: false,
      })
    }
  })

  return {
    pts: out.map((n) => n.p),
    inShaft: out.slice(0, -1).map((n) => n.shaft),
    elevators: out.flatMap((n, i) => (n.elevator ? [{ ...n.elevator, at: i }] : [])),
  }
}
