import * as THREE from 'three'
import * as Sentry from '@sentry/nextjs'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  buildFaces,
  faceContains,
  matchSpaces,
  toBuilding,
  type BuildingTransform,
  type FloorPlanDoc,
  type Pt,
  type SitePlanDoc,
  type SpaceKind,
} from '@studenthub/campus-core'
import {
  floorMesh,
  slabMesh,
  spaceHighlightMesh,
  type FloorMesh,
  type MeshBuffers,
} from '@studenthub/campus-core/mesh'
import { SPACE_KIND_COLOR } from '../../../entities/campus'
import { MOTION, prefersReducedMotion } from '../../../shared/lib'

/**
 * Сцена кампуса на three (docs/CAMPUS_BUILDER.md §13). Императивный класс: React только
 * монтирует его и передаёт данные. Рисуем по требованию (камера сдвинулась, данные
 * сменились), а не в цикле: карта большую часть времени стоит, и батарея ноутбука это
 * заметит. Всё созданное (геометрии, материалы) удаляется при пересборке и размонтировании.
 */
export interface SceneFloor {
  id: string
  buildingId: string
  level: number
  doc: FloorPlanDoc
  elevationMm: number
  heightMm: number
  transform?: BuildingTransform
  outline?: Pt[]
}

/**
 * Режимы обзора (§13.4): этаж — только выбранный, без потолка; корпус — этажи всех корпусов
 * до уровня выбранного включительно, выше — скрыты («кукольный домик» по всему кампусу);
 * кампус — корпуса коробками по контуру, без внутренних стен: на 20 корпусах это десятки
 * draw calls вместо сотен.
 */
export type SceneMode = 'floor' | 'building' | 'campus'

export interface SceneInput {
  floors: SceneFloor[]
  mode: SceneMode
  focusFloorId: string | null
  highlight: { floorId: string; spaceId: string } | null
  /** Маршрут в метрах сцены (x, y, z); `floor` — этаж точки (на улице — null). */
  route: { x: number; y: number; z: number; floor?: string | null }[] | null
  site: SitePlanDoc | null
}

export interface ScenePalette {
  background: string
  wall: string
  slab: string
  primary: string
  ground: string
}

// Территория — приглушённо: она фон для корпусов и маршрута, а не главное на карте.
/**
 * Кэш геометрии этажей (§21, задача 22.31): документ неизменяемый, поэтому ключ — сама ссылка
 * на него (WeakMap — память освобождается вместе с документом). Подсветка помещения, маршрут
 * и смена режима пересобирают сцену, но не пересчитывают стены и полы.
 */
const meshCache = new WeakMap<FloorPlanDoc, Map<string, FloorMesh>>()

function cachedFloorMesh(
  doc: FloorPlanDoc,
  opts: { elevationMm: number; heightMm: number; transform?: BuildingTransform },
): FloorMesh {
  const t = opts.transform
  const key = `${opts.elevationMm}|${opts.heightMm}|${t ? `${t.x},${t.y},${t.rotationDeg}` : ''}`
  let byKey = meshCache.get(doc)
  if (!byKey) meshCache.set(doc, (byKey = new Map()))
  let mesh = byKey.get(key)
  if (!mesh) {
    const started = performance.now()
    mesh = floorMesh(doc, opts)
    reportSlowMesh(performance.now() - started, Object.keys(doc.walls).length)
    byKey.set(key, mesh)
  }
  return mesh
}

/** Медленная сборка этажа — метка в Sentry, раз за сессию (§22.34). */
let slowReported = false
function reportSlowMesh(ms: number, walls: number): void {
  if (ms < 500 || slowReported) return
  slowReported = true
  Sentry.captureMessage('campus.slow_floor_mesh', {
    level: 'info',
    tags: { area: 'campus-3d' },
    extra: { ms: Math.round(ms), walls },
  })
}

/** Кадр дольше — снижаем плотность пикселей (адаптивное качество, §21). */
const SLOW_FRAME_MS = 28

/**
 * Клавиши камеры (по `code` — не зависят от раскладки): держишь — движется, отпустил — стоит.
 * Скорости — в долях расстояния до цели в секунду, чтобы и вблизи, и издали шаг был соразмерен.
 */
const KEY_PAN = 0.9
const KEY_ROTATE = Math.PI / 2
const KEY_TILT = Math.PI / 3
const KEY_ZOOM = 1.6
const CAMERA_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'KeyR',
  'KeyF',
  'Equal',
  'Minus',
  'NumpadAdd',
  'NumpadSubtract',
])
/** Перелёт камеры: двойной клик, «общий вид», подвод к помещению. */
const FLIGHT_MS = MOTION.large * 1.5

/**
 * Колесо: шаг мелкий (щелчок колеса ≈ 10 %), а сам зум доезжает плавно — накопленный сдвиг
 * гасится по экспоненте за ~0,2 с. Щипок тачпада (wheel + ctrl) приходит мелкими порциями —
 * у него свой, больший коэффициент.
 */
const WHEEL_STEP = 0.001
const WHEEL_PINCH = 0.01
const WHEEL_SMOOTH = 14

/**
 * Проход по маршруту: камера идёт следом за точкой «как в навигаторе» — сзади и сверху,
 * с запаздыванием, чтобы повороты не дёргали картинку. Длительность — от длины пути,
 * в разумных пределах: короткий маршрут не мелькает, длинный не тянется минутами.
 */
const TOUR_MIN_S = 8
const TOUR_MAX_S = 30
const TOUR_M_PER_S = 8
const TOUR_BEHIND_M = 16
const TOUR_ABOVE_M = 12
const TOUR_AHEAD_M = 8

const SITE_COLORS: Record<string, string> = {
  lawn: '#bbf7d0',
  parking: '#e2e8f0',
  sport: '#fed7aa',
  rest: '#d9f99d',
  path: '#e7e5e4',
  road: '#cbd5e1',
  tree: '#4ade80',
}

export class CampusSceneController {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly content = new THREE.Group()
  private readonly disposables: { dispose: () => void }[] = []
  private readonly pickables: THREE.Mesh[] = []
  private frame = 0
  private fitted = false
  private input: SceneInput | null = null
  private palette: ScenePalette
  /** Грани и помещения этажей — для выбора помещения кликом. */
  private readonly faceCache = new Map<
    string,
    {
      doc: FloorPlanDoc
      faces: ReturnType<typeof buildFaces>['faces']
      spaceByFace: Map<string, string>
    }
  >()
  onPick: ((floorId: string, spaceId: string) => void) | null = null
  onContextLost: ((lost: boolean) => void) | null = null
  /** Проход по маршруту дошёл до этажа (экран переключает уровень, чтобы верх не мешал). */
  onTourFloor: ((floorId: string) => void) | null = null
  /** Проход закончился: дошли до конца или человек взял камеру в руки. */
  onTourEnd: (() => void) | null = null

  constructor(
    private readonly host: HTMLElement,
    palette: ScenePalette,
  ) {
    this.palette = palette
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    this.renderer.setSize(host.clientWidth, host.clientHeight)
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.touchAction = 'none'
    host.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color(palette.background)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.8))
    const sun = new THREE.DirectionalLight(0xffffff, 1.1)
    sun.position.set(60, 140, 40)
    this.scene.add(sun)
    this.scene.add(this.content)

    this.camera = new THREE.PerspectiveCamera(
      45,
      Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight),
      0.3,
      5000,
    )
    this.camera.position.set(40, 50, 40)
    // Колесо — своё, плавное (см. `wheel`): слушатель вешаем ДО OrbitControls, чтобы
    // остановить событие раньше его обработчика. Щипок на сенсоре остаётся за ним.
    this.renderer.domElement.addEventListener('wheel', this.wheel, { passive: false })
    // ЛКМ — вращать, ПКМ / Shift+ЛКМ — сдвиг; инерция гасится сама за несколько кадров
    // (кадры идут, только пока камера движется — см. `tick`).
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.15
    this.controls.maxPolarAngle = Math.PI * 0.49
    this.controls.screenSpacePanning = true
    this.controls.addEventListener('change', () => this.requestRender())
    this.controls.addEventListener('start', this.grab)

    const el = this.renderer.domElement
    // Холст в порядке Tab: клавиши камеры работают, когда он в фокусе.
    el.tabIndex = 0
    el.style.outline = 'none'
    el.addEventListener('webglcontextlost', this.lost)
    el.addEventListener('webglcontextrestored', this.restored)
    el.addEventListener('pointerdown', this.pointerDown)
    el.addEventListener('pointerup', this.pointerUp)
    el.addEventListener('dblclick', this.dblClick)
    el.addEventListener('keydown', this.keyDown)
    el.addEventListener('keyup', this.keyUp)
    el.addEventListener('blur', this.releaseKeys)

    // Идущая по маршруту точка — вне `content`: пересборка сцены её не трогает.
    this.walker = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 16, 12),
      new THREE.MeshBasicMaterial({ color: palette.primary, depthTest: false, transparent: true }),
    )
    this.walker.renderOrder = 11
    this.walker.visible = false
    this.scene.add(this.walker)
  }

  setPalette(p: ScenePalette): void {
    this.palette = p
    ;(this.walker.material as THREE.MeshBasicMaterial).color.set(p.primary)
    this.scene.background = new THREE.Color(p.background)
    if (this.input) this.rebuild()
  }

  update(input: SceneInput): void {
    const modeChanged = !!this.input && this.input.mode !== input.mode
    // Маршрут сменился — старый проход больше ни к чему.
    if (this.tour && this.input?.route !== input.route) this.stopTour()
    this.input = input
    this.rebuild()
    // Пока человек не трогал камеру, вид следует за догружающимися этажами; потом — только
    // при смене режима. Смена этажа камеру не двигает: он рядом с тем, что уже на экране.
    if (modeChanged) this.touched = false
    if (!this.touched || !this.fitted) this.fit(modeChanged && this.fitted)
  }

  resize(): void {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.requestRender()
  }

  /** Камера на всё содержимое сцены сверху-сбоку; `animate` — перелётом. */
  fit(animate = false): void {
    const box = new THREE.Box3().setFromObject(this.content)
    if (box.isEmpty()) return
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const r = Math.max(size.x, size.z, size.y * 2, 5)
    this.camera.near = Math.max(0.1, r / 500)
    this.camera.far = r * 20
    this.camera.updateProjectionMatrix()
    this.controls.minDistance = 2
    this.controls.maxDistance = r * 4
    const position = new THREE.Vector3(center.x + r * 0.7, center.y + r * 0.9, center.z + r * 0.95)
    this.fitted = true
    this.flyTo(position, center, animate)
  }

  /** Общий вид — по кнопке или клавише: перелётом, и дальше камера снова «своя». */
  resetView(): void {
    this.fit(true)
    this.touched = true
  }

  /** Подвести камеру к точке (найденное помещение, начало маршрута). */
  focusOn(x: number, y: number, z: number, distance = 25): void {
    const target = new THREE.Vector3(x, y, z)
    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    this.touched = true
    this.flyTo(target.clone().add(dir.multiplyScalar(distance)), target, this.fitted)
  }

  requestRender(): void {
    if (!this.frame) this.frame = requestAnimationFrame(this.tick)
  }

  // ── Движение камеры ──────────────────────────────────────────────────────────────

  /** Человек взял камеру в свои руки: вид больше не подстраивается сам, перелёт прерван. */
  private touched = false
  private flight: {
    fromPos: THREE.Vector3
    fromTarget: THREE.Vector3
    toPos: THREE.Vector3
    toTarget: THREE.Vector3
    start: number
  } | null = null
  private readonly keys = new Set<string>()
  private shift = false
  private lastTick = 0

  /**
   * Кадр по требованию: перелёт, удерживаемые клавиши и инерция мыши просят следующий кадр,
   * пока движутся; встали — цикл останавливается.
   */
  private readonly tick = (now: number): void => {
    this.frame = 0
    const dt = this.lastTick ? Math.min(0.05, (now - this.lastTick) / 1000) : 1 / 60
    let busy = false
    if (this.flight) busy = this.stepFlight(now)
    if (this.keys.size) {
      this.stepKeys(dt)
      busy = true
    }
    if (this.zoomPending !== 0) {
      this.stepWheel(dt)
      busy = true
    }
    if (this.tour) {
      this.stepTour(dt)
      busy = true
    }
    // Инерция: пока она гасится, `update` шлёт `change` и сам просит следующий кадр.
    this.controls.update()
    const started = performance.now()
    this.renderer.render(this.scene, this.camera)
    this.adapt(performance.now() - started)
    this.lastTick = busy ? now : 0
    if (busy) this.requestRender()
  }

  private flyTo(position: THREE.Vector3, target: THREE.Vector3, animate: boolean): void {
    if (!animate || prefersReducedMotion()) {
      this.flight = null
      this.camera.position.copy(position)
      this.controls.target.copy(target)
      this.controls.update()
      this.requestRender()
      return
    }
    this.flight = {
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: position.clone(),
      toTarget: target.clone(),
      start: performance.now(),
    }
    this.requestRender()
  }

  /** Шаг перелёта: быстрый старт, мягкая остановка (кривая MOTION.ease, приближённо). */
  private stepFlight(now: number): boolean {
    const f = this.flight!
    const t = Math.min(1, (now - f.start) / FLIGHT_MS)
    const k = 1 - Math.pow(1 - t, 4)
    this.camera.position.lerpVectors(f.fromPos, f.toPos, k)
    this.controls.target.lerpVectors(f.fromTarget, f.toTarget, k)
    if (t >= 1) this.flight = null
    return t < 1
  }

  private stepKeys(dt: number): void {
    const has = (...codes: string[]): boolean => codes.some((c) => this.keys.has(c))
    // Shift + стрелки — поворот и наклон, без Shift — сдвиг; WASD — всегда сдвиг.
    const arrowsTurn = this.shift
    const axis = (plus: boolean, minus: boolean): number => (plus ? 1 : 0) - (minus ? 1 : 0)
    const fwd = axis(
      has('KeyW') || (!arrowsTurn && has('ArrowUp')),
      has('KeyS') || (!arrowsTurn && has('ArrowDown')),
    )
    const right = axis(
      has('KeyD') || (!arrowsTurn && has('ArrowRight')),
      has('KeyA') || (!arrowsTurn && has('ArrowLeft')),
    )
    const rot = axis(
      has('KeyE') || (arrowsTurn && has('ArrowRight')),
      has('KeyQ') || (arrowsTurn && has('ArrowLeft')),
    )
    const tilt = axis(
      has('KeyF') || (arrowsTurn && has('ArrowDown')),
      has('KeyR') || (arrowsTurn && has('ArrowUp')),
    )
    const zoom = axis(has('Equal', 'NumpadAdd'), has('Minus', 'NumpadSubtract'))

    const target = this.controls.target
    const offset = this.camera.position.clone().sub(target)
    const dist = offset.length()
    if (fwd || right) {
      // Вперёд — по направлению взгляда, но по земле: камера не ныряет в пол.
      const forward = offset.clone().negate().setY(0)
      if (forward.lengthSq() < 1e-9) forward.set(0, 0, -1)
      forward.normalize()
      const side = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize()
      const step = dist * KEY_PAN * dt
      const move = forward.multiplyScalar(fwd * step).add(side.multiplyScalar(right * step))
      target.add(move)
      this.camera.position.add(move)
    }
    if (rot || tilt || zoom) {
      const s = new THREE.Spherical().setFromVector3(offset)
      s.theta += rot * KEY_ROTATE * dt
      s.phi = THREE.MathUtils.clamp(s.phi + tilt * KEY_TILT * dt, 0.05, this.controls.maxPolarAngle)
      s.radius = THREE.MathUtils.clamp(
        s.radius * Math.exp(-zoom * KEY_ZOOM * dt),
        this.controls.minDistance,
        this.controls.maxDistance,
      )
      this.camera.position.copy(target).add(offset.setFromSpherical(s))
    }
  }

  private readonly grab = (): void => {
    this.touched = true
    this.flight = null
    if (this.tour) this.stopTour()
  }

  // ── Колесо ───────────────────────────────────────────────────────────────────────

  /** Ещё не применённый зум (логарифм множителя; > 0 — ближе) и точка, к которой зумим. */
  private zoomPending = 0
  private zoomAnchor: THREE.Vector3 | null = null
  private lastWheel: { x: number; y: number } | null = null

  private readonly wheel = (e: WheelEvent): void => {
    e.preventDefault()
    e.stopImmediatePropagation()
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1
    const k = e.ctrlKey ? WHEEL_PINCH : WHEEL_STEP
    this.zoomPending = THREE.MathUtils.clamp(this.zoomPending - e.deltaY * unit * k, -2, 2)
    // Луч к курсору — только когда курсор сдвинулся: тачпад шлёт десятки событий в секунду.
    const last = this.lastWheel
    if (!this.zoomAnchor || !last || Math.hypot(e.clientX - last.x, e.clientY - last.y) > 4) {
      const hit = this.raycast(e.clientX, e.clientY, this.content.children)
      this.zoomAnchor = hit?.point.clone() ?? this.groundAt(e.clientX, e.clientY)
      this.lastWheel = { x: e.clientX, y: e.clientY }
    }
    this.grab()
    this.requestRender()
  }

  /** Точка земли (y = 0) под курсором; мимо земли — текущая цель камеры. */
  private groundAt(clientX: number, clientY: number): THREE.Vector3 {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ray = new THREE.Raycaster()
    ray.setFromCamera(
      new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    )
    const p = new THREE.Vector3()
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)
      ? p
      : this.controls.target.clone()
  }

  /** Доля накопленного зума за кадр: камера и цель едут к точке под курсором. */
  private stepWheel(dt: number): void {
    const take =
      Math.abs(this.zoomPending) < 1e-3
        ? this.zoomPending
        : this.zoomPending * (1 - Math.exp(-dt * WHEEL_SMOOTH))
    this.zoomPending -= take
    if (Math.abs(this.zoomPending) < 1e-4) this.zoomPending = 0
    const anchor = this.zoomAnchor ?? this.controls.target
    const dist = this.camera.position.distanceTo(this.controls.target)
    const next = THREE.MathUtils.clamp(
      dist * Math.exp(-take),
      this.controls.minDistance,
      this.controls.maxDistance,
    )
    if (dist <= 0 || next === dist) {
      this.zoomPending = 0
      return
    }
    const f = next / dist
    this.camera.position.sub(anchor).multiplyScalar(f).add(anchor)
    this.controls.target.sub(anchor).multiplyScalar(f).add(anchor)
  }

  // ── Проход по маршруту ───────────────────────────────────────────────────────────

  private readonly walker: THREE.Mesh
  private tour: {
    pts: THREE.Vector3[]
    floors: (string | null)[]
    /** Пройденная длина до каждой точки, м. */
    cum: number[]
    length: number
    speed: number
    s: number
    heading: THREE.Vector3
    floor: string | null
  } | null = null

  /** Пройти по маршруту камерой. Нет маршрута — `false`. */
  startTour(): boolean {
    const route = this.input?.route
    if (!route || route.length < 2) return false
    const pts = route.map((p) => new THREE.Vector3(p.x, p.y + 0.3, p.z))
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!))
    const length = cum[cum.length - 1]!
    if (length < 1) return false
    // Перезапуск — тихо, без onTourEnd: экран уже считает, что проход идёт.
    this.tour = null
    this.grab()
    const seconds = THREE.MathUtils.clamp(length / TOUR_M_PER_S, TOUR_MIN_S, TOUR_MAX_S)
    const heading = pts[1]!.clone().sub(pts[0]!).setY(0)
    if (heading.lengthSq() < 1e-6) heading.set(0, 0, -1)
    this.tour = {
      pts,
      floors: route.map((p) => p.floor ?? null),
      cum,
      length,
      speed: length / seconds,
      s: 0,
      heading: heading.normalize(),
      floor: null,
    }
    this.walker.visible = true
    this.requestRender()
    return true
  }

  /** Остановить проход; камера остаётся, где была. */
  stopTour(): void {
    if (!this.tour) return
    this.tour = null
    this.walker.visible = false
    this.requestRender()
    this.onTourEnd?.()
  }

  /** Точка пути на расстоянии `s` от начала и индекс участка. */
  private tourAt(s: number): { p: THREE.Vector3; i: number } {
    const t = this.tour!
    let i = 0
    while (i < t.cum.length - 2 && t.cum[i + 1]! < s) i++
    const seg = t.cum[i + 1]! - t.cum[i]!
    const k = seg > 0 ? (s - t.cum[i]!) / seg : 0
    return { p: t.pts[i]!.clone().lerp(t.pts[i + 1]!, THREE.MathUtils.clamp(k, 0, 1)), i }
  }

  private stepTour(dt: number): void {
    const t = this.tour!
    t.s = Math.min(t.length, t.s + t.speed * dt)
    const { p, i } = this.tourAt(t.s)
    const ahead = this.tourAt(Math.min(t.length, t.s + TOUR_AHEAD_M))
      .p.sub(p)
      .setY(0)
    // На лестнице направление по земле почти нулевое — держим прежнее.
    if (ahead.lengthSq() > 0.04)
      t.heading.lerp(ahead.normalize(), 1 - Math.exp(-dt * 3)).normalize()
    const want = p
      .clone()
      .addScaledVector(t.heading, -TOUR_BEHIND_M)
      .add(new THREE.Vector3(0, TOUR_ABOVE_M, 0))
    this.camera.position.lerp(want, 1 - Math.exp(-dt * 4))
    this.controls.target.lerp(p, 1 - Math.exp(-dt * 6))
    this.walker.position.copy(p)
    const floor = t.floors[i] ?? t.floors[i + 1] ?? null
    if (floor && floor !== t.floor) {
      t.floor = floor
      this.onTourFloor?.(floor)
    }
    if (t.s >= t.length) this.stopTour()
  }

  private readonly keyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    this.shift = e.shiftKey
    if (e.code === 'Home' || e.code === 'Digit0' || e.code === 'Numpad0') {
      e.preventDefault()
      this.resetView()
      return
    }
    if (!CAMERA_KEYS.has(e.code)) return
    e.preventDefault()
    this.grab()
    this.keys.add(e.code)
    this.requestRender()
  }

  private readonly keyUp = (e: KeyboardEvent): void => {
    this.shift = e.shiftKey
    this.keys.delete(e.code)
  }

  private readonly releaseKeys = (): void => {
    this.keys.clear()
    this.shift = false
  }

  /** Двойной клик — подлететь к точке под курсором вдвое ближе. */
  private readonly dblClick = (e: MouseEvent): void => {
    const hit = this.raycast(e.clientX, e.clientY, this.content.children)
    if (!hit) return
    const target = hit.point.clone()
    const dir = this.camera.position.clone().sub(this.controls.target)
    const dist = THREE.MathUtils.clamp(
      dir.length() * 0.45,
      this.controls.minDistance,
      this.controls.maxDistance,
    )
    this.grab()
    this.flyTo(target.clone().add(dir.normalize().multiplyScalar(dist)), target, true)
  }

  private raycast(
    clientX: number,
    clientY: number,
    objects: THREE.Object3D[],
  ): THREE.Intersection | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, this.camera)
    return ray.intersectObjects(objects, false)[0]
  }

  private slowFrames = 0

  /**
   * Слабое устройство: несколько медленных кадров подряд — плотность пикселей вниз (1,5 → 1 →
   * 0,75). Вверх не возвращаем: качание качества заметнее, чем чуть менее чёткая картинка.
   */
  private adapt(ms: number): void {
    if (ms < SLOW_FRAME_MS) {
      this.slowFrames = 0
      return
    }
    this.slowFrames += 1
    const ratio = this.renderer.getPixelRatio()
    if (this.slowFrames < 5 || ratio <= 0.75) return
    this.slowFrames = 0
    this.renderer.setPixelRatio(ratio > 1 ? 1 : 0.75)
    this.renderer.setSize(this.host.clientWidth, this.host.clientHeight)
    Sentry.addBreadcrumb({
      category: 'campus-3d',
      message: `pixel ratio ${ratio} → ${this.renderer.getPixelRatio()}`,
      data: { ms: Math.round(ms) },
    })
    this.requestRender()
  }

  dispose(): void {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.clear()
    this.tour = null
    this.walker.geometry.dispose()
    ;(this.walker.material as THREE.Material).dispose()
    this.controls.removeEventListener('start', this.grab)
    this.controls.dispose()
    const el = this.renderer.domElement
    el.removeEventListener('webglcontextlost', this.lost)
    el.removeEventListener('webglcontextrestored', this.restored)
    el.removeEventListener('pointerdown', this.pointerDown)
    el.removeEventListener('pointerup', this.pointerUp)
    el.removeEventListener('dblclick', this.dblClick)
    el.removeEventListener('wheel', this.wheel)
    el.removeEventListener('keydown', this.keyDown)
    el.removeEventListener('keyup', this.keyUp)
    el.removeEventListener('blur', this.releaseKeys)
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    el.remove()
  }

  // ── Сборка ───────────────────────────────────────────────────────────────────────

  private clear(): void {
    for (const d of this.disposables) d.dispose()
    this.disposables.length = 0
    this.pickables.length = 0
    this.content.clear()
  }

  private geometry(m: MeshBuffers): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3))
    g.setIndex(new THREE.BufferAttribute(m.indices, 1))
    g.computeBoundingSphere()
    this.disposables.push(g)
    return g
  }

  private material<T extends THREE.Material>(m: T): T {
    this.disposables.push(m)
    return m
  }

  private rebuild(): void {
    const input = this.input
    if (!input) return
    this.clear()
    const wallMat = this.material(new THREE.MeshLambertMaterial({ color: this.palette.wall }))
    const glassMat = this.material(
      new THREE.MeshLambertMaterial({
        color: '#7dd3fc',
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    )
    const slabMat = this.material(new THREE.MeshLambertMaterial({ color: this.palette.slab }))
    // Лестницы — светлым камнем, шахты лифтов — тёмным металлом: видно сквозь окна и сверху.
    const stairsMat = this.material(new THREE.MeshLambertMaterial({ color: '#d6d3d1' }))
    const liftMat = this.material(new THREE.MeshLambertMaterial({ color: '#475569' }))
    const kindMats = new Map<SpaceKind | 'none', THREE.Material>()
    const kindMat = (k: SpaceKind | 'none'): THREE.Material => {
      let m = kindMats.get(k)
      if (!m) {
        // Цвет типа, разбавленный белым: насыщенные полы спорят с подсветкой и маршрутом.
        const color =
          k === 'none'
            ? new THREE.Color(this.palette.slab)
            : new THREE.Color(SPACE_KIND_COLOR[k]).lerp(new THREE.Color('#ffffff'), 0.45)
        m = this.material(new THREE.MeshLambertMaterial({ color }))
        kindMats.set(k, m)
      }
      return m
    }

    const focus = input.floors.find((f) => f.id === input.focusFloorId) ?? null
    // Кампус: корпус, у которого пришли планы всех этажей, рисуется настоящими фасадами (стены,
    // окна, крыша); остальные — коробкой. Зритель решает, грузить ли планы (небольшой кампус).
    const detailed = new Set<string>()
    if (input.mode === 'campus') {
      const byB = new Map<string, SceneFloor[]>()
      for (const f of input.floors) byB.set(f.buildingId, [...(byB.get(f.buildingId) ?? []), f])
      for (const [id, fs] of byB)
        if (fs.every((f) => Object.keys(f.doc.walls).length > 0)) detailed.add(id)
    }
    const visible = input.floors.filter((f) => {
      if (input.mode === 'campus') return detailed.has(f.buildingId)
      if (input.mode === 'floor') return f.id === focus?.id
      // Корпус: этажи всех корпусов до уровня выбранного включительно.
      return !focus || f.level <= focus.level
    })

    for (const f of visible) {
      const opts = { elevationMm: f.elevationMm, heightMm: f.heightMm, transform: f.transform }
      const mesh = cachedFloorMesh(f.doc, opts)
      const walls = new THREE.Mesh(this.geometry(mesh.walls), wallMat)
      this.content.add(walls)
      if (mesh.glass.indices.length)
        this.content.add(new THREE.Mesh(this.geometry(mesh.glass), glassMat))
      if (mesh.stairs.indices.length)
        this.content.add(new THREE.Mesh(this.geometry(mesh.stairs), stairsMat))
      if (mesh.elevators.indices.length)
        this.content.add(new THREE.Mesh(this.geometry(mesh.elevators), liftMat))
      for (const [kind, buf] of Object.entries(mesh.floors)) {
        const floor = new THREE.Mesh(this.geometry(buf!), kindMat(kind as SpaceKind | 'none'))
        floor.userData.floorId = f.id
        this.pickables.push(floor)
        this.content.add(floor)
      }
      if (f.outline?.length) {
        this.content.add(
          new THREE.Mesh(
            this.geometry(slabMesh(f.outline, f.elevationMm, 150, f.transform)),
            slabMat,
          ),
        )
      }
    }

    if (input.mode === 'campus') {
      // Корпус коробкой: перекрытие на каждом этаже + полупрозрачная оболочка.
      const shellMat = this.material(
        new THREE.MeshLambertMaterial({
          color: this.palette.wall,
          transparent: true,
          opacity: 0.85,
        }),
      )
      const byBuilding = new Map<string, SceneFloor[]>()
      for (const f of input.floors) {
        const list = byBuilding.get(f.buildingId)
        if (list) list.push(f)
        else byBuilding.set(f.buildingId, [f])
      }
      for (const [buildingId, floors] of byBuilding) {
        const outline = floors[0]?.outline
        if (!outline?.length) continue
        const bottom = Math.min(...floors.map((f) => f.elevationMm))
        const top = Math.max(...floors.map((f) => f.elevationMm + f.heightMm))
        if (detailed.has(buildingId)) {
          // Фасады уже нарисованы этажами — сверху только крыша.
          this.content.add(
            new THREE.Mesh(
              this.geometry(slabMesh(outline, top + 200, 200, floors[0]!.transform)),
              slabMat,
            ),
          )
          continue
        }
        this.content.add(
          new THREE.Mesh(
            this.geometry(slabMesh(outline, top, top - bottom, floors[0]!.transform)),
            shellMat,
          ),
        )
      }
    }

    if (input.highlight) {
      const f = input.floors.find((x) => x.id === input.highlight!.floorId)
      if (f) {
        const buf = spaceHighlightMesh(f.doc, input.highlight.spaceId, {
          elevationMm:
            input.mode === 'campus'
              ? Math.max(
                  ...input.floors
                    .filter((x) => x.buildingId === f.buildingId)
                    .map((x) => x.elevationMm + x.heightMm),
                ) + 50
              : f.elevationMm,
          heightMm: f.heightMm,
          transform: f.transform,
        })
        if (buf) {
          const mat = this.material(
            new THREE.MeshBasicMaterial({
              color: this.palette.primary,
              transparent: true,
              opacity: 0.85,
              depthTest: input.mode !== 'campus',
            }),
          )
          this.content.add(new THREE.Mesh(this.geometry(buf), mat))
        }
      }
    }

    if (input.route && input.route.length > 1) {
      const pts = input.route.map((p) => new THREE.Vector3(p.x, p.y + 0.3, p.z))
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.05)
      const tube = new THREE.TubeGeometry(curve, Math.min(800, pts.length * 8), 0.18, 6, false)
      this.disposables.push(tube)
      const mat = this.material(
        new THREE.MeshBasicMaterial({
          color: this.palette.primary,
          depthTest: false,
          transparent: true,
        }),
      )
      const route = new THREE.Mesh(tube, mat)
      route.renderOrder = 10
      this.content.add(route)
    }

    if (input.site) this.buildSite(input.site)
    this.requestRender()
  }

  /** Территория (§14): газоны, площадки — плоские многоугольники, дорожки — ленты. */
  private buildSite(site: SitePlanDoc): void {
    const mats = new Map<string, THREE.Material>()
    const mat = (type: string): THREE.Material => {
      let m = mats.get(type)
      if (!m) {
        m = this.material(
          new THREE.MeshLambertMaterial({ color: SITE_COLORS[type] ?? this.palette.ground }),
        )
        mats.set(type, m)
      }
      return m
    }
    const toScene = (p: Pt) => ({ x: p.x / 1000, z: -p.y / 1000 })
    for (const f of Object.values(site.features)) {
      if ('polygon' in f) {
        const shape = new THREE.Shape(
          f.polygon.map((p) => new THREE.Vector2(p.x / 1000, p.y / 1000)),
        )
        const g = new THREE.ShapeGeometry(shape)
        g.rotateX(-Math.PI / 2)
        g.translate(0, -0.02, 0)
        this.disposables.push(g)
        this.content.add(new THREE.Mesh(g, mat(f.type)))
      } else if ('line' in f) {
        for (let i = 0; i + 1 < f.line.length; i++) {
          const a = toScene(f.line[i]!)
          const b = toScene(f.line[i + 1]!)
          const len = Math.hypot(b.x - a.x, b.z - a.z)
          if (len < 0.01) continue
          const g = new THREE.PlaneGeometry(len, f.widthMm / 1000)
          g.rotateX(-Math.PI / 2)
          g.rotateY(-Math.atan2(b.z - a.z, b.x - a.x))
          g.translate((a.x + b.x) / 2, -0.01, (a.z + b.z) / 2)
          this.disposables.push(g)
          this.content.add(new THREE.Mesh(g, mat(f.type)))
        }
      }
    }
    // Деревья — по одному инстансу на дерево: сотни деревьев остаются одним draw call.
    const trees = Object.values(site.features).filter((f) => f.type === 'tree')
    if (trees.length > 0) {
      const cone = new THREE.ConeGeometry(1.4, 4, 7)
      cone.translate(0, 2, 0)
      this.disposables.push(cone)
      const mesh = new THREE.InstancedMesh(cone, mat('tree'), trees.length)
      const m = new THREE.Matrix4()
      trees.forEach((f, i) => {
        if (f.type !== 'tree') return
        // Хвойные выше и уже лиственных.
        const k = f.variant === 'conifer' ? 1.3 : 1
        m.makeScale(1 / k, k, 1 / k).setPosition(f.x / 1000, 0, -f.y / 1000)
        mesh.setMatrixAt(i, m)
      })
      mesh.instanceMatrix.needsUpdate = true
      this.disposables.push({ dispose: () => mesh.dispose() })
      this.content.add(mesh)
    }
  }

  // ── Выбор помещения ──────────────────────────────────────────────────────────────

  private down: { x: number; y: number } | null = null

  private readonly pointerDown = (e: PointerEvent): void => {
    this.down = { x: e.clientX, y: e.clientY }
    this.renderer.domElement.style.cursor = 'grabbing'
  }

  /** Клик без перетаскивания — выбор помещения под курсором. */
  private readonly pointerUp = (e: PointerEvent): void => {
    const d = this.down
    this.down = null
    this.renderer.domElement.style.cursor = ''
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || !this.onPick || !this.input)
      return
    const hit = this.raycast(e.clientX, e.clientY, this.pickables)
    if (!hit) return
    const floorId = hit.object.userData.floorId as string
    const floor = this.input.floors.find((f) => f.id === floorId)
    if (!floor) return
    const campusPt = { x: hit.point.x * 1000, y: -hit.point.z * 1000 }
    const local = floor.transform ? toBuilding(campusPt, floor.transform) : campusPt
    const cache = this.faces(floor)
    const face = cache.faces.find((f) => faceContains(f, local))
    const spaceId = face ? cache.spaceByFace.get(face.id) : undefined
    if (spaceId) this.onPick(floorId, spaceId)
  }

  private faces(floor: SceneFloor) {
    const cached = this.faceCache.get(floor.id)
    if (cached && cached.doc === floor.doc) return cached
    const faces = buildFaces(floor.doc).faces
    const { assignments } = matchSpaces(floor.doc, {}, faces)
    const entry = {
      doc: floor.doc,
      faces,
      spaceByFace: new Map(Object.entries(assignments).map(([s, f]) => [f, s])),
    }
    this.faceCache.set(floor.id, entry)
    return entry
  }

  private readonly lost = (e: Event): void => {
    // Без preventDefault браузер не вернёт контекст.
    e.preventDefault()
    this.onContextLost?.(true)
    Sentry.captureMessage('campus.webgl_context_lost', {
      level: 'warning',
      tags: { area: 'campus-3d', mode: this.input?.mode ?? 'none' },
      extra: { floors: this.input?.floors.length ?? 0, pixelRatio: this.renderer.getPixelRatio() },
    })
  }

  private readonly restored = (): void => {
    this.onContextLost?.(false)
    this.rebuild()
  }
}
