import * as THREE from 'three'
import * as Sentry from '@sentry/nextjs'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  buildFaces,
  faceContains,
  matchSpaces,
  pointInPolygon,
  toBuilding,
  toCampus,
  type BuildingTransform,
  type FloorPlanDoc,
  type Pt,
  type SitePlanDoc,
  type SpaceKind,
} from '@studenthub/campus-core'
import {
  floorMesh,
  ceilingMesh,
  slabMesh,
  spaceHighlightMesh,
  verticalOpening,
  type FloorMesh,
  type MeshBuffers,
} from '@studenthub/campus-core/mesh'
import { SPACE_KIND_COLOR } from '../../../entities/campus'
import { MOTION, prefersReducedMotion } from '../../../shared/lib'
import { buildDoorSigns, type DoorSigns } from './door-signs'
import { ElevatorCabin } from './elevator-cabin'
import { buildSiteVisual, type SiteVisual } from './site-visual'
import { routePath, type RouteElevator, type RoutePath, type RoutePoint } from './route-path'
import {
  ARROW_STEP_M,
  RIBBON_WIDTH_M,
  pathLengths,
  pinTexture,
  pointAt,
  ribbonGeometry,
  ribbonTexture,
} from './route-visual'

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
  /**
   * Маршрут в метрах сцены (x, y, z); `floor` — этаж точки (на улице — null), `via` — тип
   * ребра графа, которым к точке пришли: лестница разворачивается в марш, лифт — в поездку.
   */
  route: RoutePoint[] | null
  /** Все этажи корпусов (и выше видимых) — кнопки в кабине лифта. */
  floorIndex?: { id: string; buildingId: string; label: string; elevationMm: number }[]
  /** Буквы булавок начала и конца маршрута (по умолчанию A и B). */
  routeMarkers?: { from: string; to: string }
  /** Подписи типов помещений — для табличек у дверей без номера и названия. */
  kindLabels?: Partial<Record<SpaceKind, string>>
  site: SitePlanDoc | null
}

export interface ScenePalette {
  /** Булавки маршрута: начало и конец. */
  start: string
  end: string
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
  opts: {
    elevationMm: number
    heightMm: number
    transform?: BuildingTransform
    openings?: Pt[][]
  },
): FloorMesh {
  const t = opts.transform
  const holes = (opts.openings ?? []).map((o) => o.map((p) => `${p.x},${p.y}`).join(';')).join('/')
  const key = `${opts.elevationMm}|${opts.heightMm}|${t ? `${t.x},${t.y},${t.rotationDeg}` : ''}|${holes}`
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
/** Небо: зенит и дымка у горизонта (ею же тонет даль). */
const SKY_ZENITH = '#5d97d6'
const SKY_HORIZON = '#dbe7f2'

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
 * Проход по маршруту от первого лица: глаза на высоте человека, шаг быстрой ходьбы, путь
 * без срезанных углов (`routePath`: марши лестниц, поездки в лифте), а взгляд догоняет направление пути с запаздыванием —
 * поворот растягивается на полсекунды, а не щёлкает. Скорость плавно набирается на старте и
 * гаснет у цели; перед ходьбой — перелёт из текущего вида к точке старта.
 */
const TOUR_EYE_M = 1.6
const TOUR_SPEED_M_S = 4.5
const TOUR_ACCEL_S = 1.2
const TOUR_BRAKE_M = 5
const TOUR_LOOK_AHEAD_M = 4
const TOUR_TURN_RATE = 3.5
const TOUR_INTRO_S = 1.8
const TOUR_FOV = 65
/** Взгляд чуть вниз — лента маршрута на полу видна. */
const TOUR_PITCH_DOWN = 0.14
const TOUR_PITCH_MAX = 0.35
const ORBIT_FOV = 45
/** Лента маршрута над полом, м: выше пола помещений (+2 см) и подсветки (+4 см). */
const RIBBON_LIFT_M = 0.07

/** Плавный старт и остановка (кубическая), для перелёта и стадий лифта. */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
}

/** Проход по маршруту: путь, где идём и куда смотрим, поездки на лифте по ходу. */
interface TourState {
  path: RoutePath
  cum: number[]
  length: number
  /** Пройдено, м, и текущая скорость, м/с. */
  s: number
  v: number
  yaw: number
  pitch: number
  /** Поездки на лифте по ходу: где начинаются (м пути) и где выходим. */
  rides: { e: RouteElevator; sFrom: number; sTo: number }[]
  ride: Ride | null
  /** Перелёт к старту: откуда, сколько прошло. */
  intro: { pos: THREE.Vector3; quat: THREE.Quaternion; fov: number; t: number } | null
}

/** Поездка на лифте: стадия, время в ней, положение глаз и откуда шли/куда смотрели. */
interface Ride {
  r: { e: RouteElevator; sFrom: number; sTo: number }
  stage: number
  time: number
  eye: THREE.Vector3
  from: THREE.Vector3
  yawFrom: number
  rideS: number
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
  /** Проход закончился: дошли до конца или человек взял камеру в руки. */
  onTourEnd: (() => void) | null = null

  constructor(
    private readonly host: HTMLElement,
    palette: ScenePalette,
  ) {
    this.palette = palette
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      // Полы, перекрытия и торцы стен лежат в сантиметрах друг от друга: с обычным буфером
      // глубины издалека они «мерцают» при каждом сдвиге камеры (z-fighting).
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    this.renderer.setSize(host.clientWidth, host.clientHeight)
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.touchAction = 'none'
    host.appendChild(this.renderer.domElement)

    // Небо — купол с градиентом от зенита к дымке у горизонта, вокруг камеры; дальнее
    // тонет в дымке того же цвета: горизонт без шва.
    this.sky = this.makeSky()
    this.scene.add(this.sky)
    this.scene.fog = new THREE.Fog(SKY_HORIZON, 600, 3000)
    // Небо сверху, трава снизу: отражённый от земли свет зеленоватый.
    this.scene.add(new THREE.HemisphereLight(0xe8f1ff, 0x5d6b4c, 1.7))
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
    // Инерция гасится сама за несколько кадров
    // (кадры идут, только пока камера движется — см. `tick`).
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.15
    this.controls.maxPolarAngle = Math.PI * 0.49
    // Как на картах (2ГИС, Google Maps): левая кнопка двигает карту, правая (или с Shift/Ctrl)
    // вращает и наклоняет; на сенсоре один палец двигает, два — масштаб и поворот.
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    }
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }
    this.controls.rotateSpeed = 0.7
    // Сдвиг — по земле, а не в плоскости экрана: иначе на наклонном виде точка вращения
    // уезжала в небо или под землю, и дальше вращение шло вокруг пустоты.
    this.controls.screenSpacePanning = false
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
  }

  setPalette(p: ScenePalette): void {
    this.palette = p
    this.disposeRouteTextures()
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
    // Центр вращения — на земле (y = 0, но в пределах содержимого), а не в середине высоты
    // зданий: вращение и наклон идут вокруг точки на карте, а не вокруг точки в воздухе.
    center.y = THREE.MathUtils.clamp(0, box.min.y, box.max.y)
    // Буфер глубины логарифмический — ближнюю плоскость можно держать близко всегда.
    this.camera.near = 0.05
    this.camera.fov = ORBIT_FOV
    // Не ближе 4 км: край земли должен тонуть в дымке, а не обрезаться.
    this.camera.far = Math.max(r * 20, 4000)
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
    // В проходе камерой правит он сам — OrbitControls развернул бы её к своей цели.
    else this.controls.update()
    this.updateSigns()
    // Купол неба — вокруг камеры, чуть ближе дальней плоскости.
    this.sky.position.copy(this.camera.position)
    this.sky.scale.setScalar(this.camera.far * 0.9)
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
    // Приближение — к точке под курсором, отдаление — от центра вида: иначе центр вращения
    // с каждым щелчком уезжал бы в сторону и вращение шло бы вокруг случайной точки.
    const anchor = take > 0 ? (this.zoomAnchor ?? this.controls.target) : this.controls.target
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

  private tour: TourState | null = null
  /** Кабина текущей поездки; пока она есть, глухие шахты лифтов спрятаны. */
  private cabin: ElevatorCabin | null = null
  private readonly shaftMeshes: THREE.Mesh[] = []

  /** Пройти по маршруту от первого лица. Нет маршрута — `false`. */
  startTour(): boolean {
    const input = this.input
    if (!input?.route || input.route.length < 2) return false
    const path = routePath(input.route, input.floors)
    const cum = pathLengths(path.pts)
    const length = cum[cum.length - 1]!
    if (length < 1) return false
    // Перезапуск — тихо, без onTourEnd: экран уже считает, что проход идёт.
    this.endRide()
    this.tour = null
    this.grab()
    const rides = path.elevators.map((e) => {
      // Выход из лифта — первая точка после цепочки отрезков в шахте.
      let j = e.at
      while (path.inShaft[j]) j++
      return { e, sFrom: cum[e.at]!, sTo: cum[j]! }
    })
    const { yaw, pitch } = this.lookAlong(path.pts, cum, 0, rides)
    this.tour = {
      path,
      cum,
      length,
      s: 0,
      v: 0,
      yaw,
      pitch,
      rides,
      ride: null,
      intro: prefersReducedMotion()
        ? null
        : {
            pos: this.camera.position.clone(),
            quat: this.camera.quaternion.clone(),
            fov: this.camera.fov,
            t: 0,
          },
    }
    this.requestRender()
    return true
  }

  /**
   * Остановить проход. Камера остаётся, где стоит, а цель орбиты ставим перед глазами —
   * дальше мышь вращает вокруг того, на что человек смотрит, без рывка.
   */
  stopTour(): void {
    if (!this.tour) return
    this.tour = null
    this.endRide()
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
    this.controls.target.copy(this.camera.position).addScaledVector(forward, 6)
    this.controls.update()
    this.requestRender()
    this.onTourEnd?.()
  }

  private endRide(): void {
    this.cabin?.dispose()
    this.cabin = null
    for (const m of this.shaftMeshes) m.visible = true
  }

  /**
   * Куда смотреть с точки `s`: на путь впереди, по высоте — сдержанно. Отвес шахты лифта
   * «впереди» не считается: в него не смотрят, в него входят.
   */
  private lookAlong(
    pts: THREE.Vector3[],
    cum: number[],
    s: number,
    rides: { sFrom: number }[],
  ): { yaw: number; pitch: number } {
    const length = cum[cum.length - 1]!
    const stop = rides.find((r) => r.sFrom > s + 1e-3)?.sFrom ?? length
    const here = pointAt(pts, cum, s)
    let ahead = pointAt(pts, cum, Math.min(stop, s + TOUR_LOOK_AHEAD_M)).sub(here)
    if (ahead.lengthSq() < 0.01) {
      // У цели или перед лифтом смотреть вперёд некуда — берём последний отрезок до точки.
      let i = 0
      while (i < cum.length - 1 && cum[i + 1]! <= s) i++
      ahead = pts[i]!.clone().sub(pts[Math.max(0, i - 1)]!)
    }
    const flat = Math.hypot(ahead.x, ahead.z)
    return {
      yaw: flat > 1e-4 ? Math.atan2(-ahead.x, -ahead.z) : (this.tour?.yaw ?? 0),
      pitch:
        THREE.MathUtils.clamp(
          Math.atan2(ahead.y, Math.max(flat, 0.5)),
          -TOUR_PITCH_MAX,
          TOUR_PITCH_MAX,
        ) - TOUR_PITCH_DOWN,
    }
  }

  private stepTour(dt: number): void {
    const t = this.tour!
    if (t.ride) {
      this.stepRide(dt)
      this.placeCamera(t, dt)
      return
    }
    const look = this.lookAlong(t.path.pts, t.cum, t.s, t.rides)
    // Поворот головы — по кратчайшей дуге и с запаздыванием; на крутом повороте шаг тише.
    const dYaw = Math.atan2(Math.sin(look.yaw - t.yaw), Math.cos(look.yaw - t.yaw))
    const k = 1 - Math.exp(-dt * TOUR_TURN_RATE)
    t.yaw += dYaw * k
    t.pitch += (look.pitch - t.pitch) * k

    // Скорость: разгон, торможение у цели и перед лифтом, тише на поворотах.
    const next = t.rides.find((r) => r.sFrom >= t.s - 1e-3)
    const stop = next ? next.sFrom : t.length
    const remain = stop - t.s
    const turn = 1 - 0.55 * Math.min(1, Math.abs(dYaw) / (Math.PI / 2))
    const want = TOUR_SPEED_M_S * turn * Math.min(1, Math.sqrt(Math.max(0, remain) / TOUR_BRAKE_M))
    t.v += (want - t.v) * (1 - Math.exp((-dt * 3) / TOUR_ACCEL_S))
    if (!t.intro) t.s = Math.min(stop, t.s + Math.max(0.15, t.v) * dt)

    this.placeCamera(t, dt)
    // Стрелки на ленте бегут вперёд в темпе шага.
    if (this.routeTex) this.routeTex.offset.x -= (Math.max(0.15, t.v) * dt) / ARROW_STEP_M
    if (t.intro) return
    if (next && t.s >= next.sFrom - 1e-3 && t.v < 0.5) this.beginRide(next)
    else if (!next && t.s >= t.length && t.v < 0.3) this.stopTour()
  }

  /** Глаза на высоте человека над точкой пути (или над полом кабины в поездке). */
  private placeCamera(t: TourState, dt: number): void {
    const eye = t.ride
      ? t.ride.eye.clone()
      : pointAt(t.path.pts, t.cum, t.s).add(new THREE.Vector3(0, TOUR_EYE_M, 0))
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(t.pitch, t.yaw, 0, 'YXZ'))
    if (t.intro) {
      t.intro.t = Math.min(1, t.intro.t + dt / TOUR_INTRO_S)
      const e = easeInOut(t.intro.t)
      this.camera.position.lerpVectors(t.intro.pos, eye, e)
      this.camera.quaternion.slerpQuaternions(t.intro.quat, quat, e)
      this.camera.fov = THREE.MathUtils.lerp(t.intro.fov, TOUR_FOV, e)
      if (t.intro.t >= 1) t.intro = null
    } else {
      this.camera.position.copy(eye)
      this.camera.quaternion.copy(quat)
      this.camera.fov = TOUR_FOV
    }
    this.camera.updateProjectionMatrix()
  }

  // ── Поездка на лифте ─────────────────────────────────────────────────────────────

  /**
   * Лифт как в жизни: повернуться к дверям, двери открываются, войти, развернуться к
   * дверям, двери закрываются, кабина едет (табло считает этажи, кнопка назначения горит),
   * двери открываются, выйти. Камера всё время на высоте глаз, без скачков.
   */
  private beginRide(r: { e: RouteElevator; sFrom: number; sTo: number }): void {
    const t = this.tour!
    const input = this.input!
    const floors = (input.floorIndex ?? [])
      .filter((f) => f.buildingId === r.e.buildingId)
      .map((f) => ({ id: f.id, label: f.label, y: f.elevationMm / 1000 }))
    this.endRide()
    this.cabin = new ElevatorCabin(r.e, floors, r.e.toFloor, this.palette.primary)
    this.scene.add(this.cabin.group)
    for (const m of this.shaftMeshes) m.visible = false
    const eye = pointAt(t.path.pts, t.cum, t.s).add(new THREE.Vector3(0, TOUR_EYE_M, 0))
    t.ride = {
      r,
      stage: 0,
      time: 0,
      eye,
      from: eye.clone(),
      yawFrom: t.yaw,
      rideS: Math.max(3, 1.6 + (1.1 * Math.abs(r.e.toY - r.e.fromY)) / 3.3),
    }
    t.v = 0
  }

  private stepRide(dt: number): void {
    const t = this.tour!
    const ride = t.ride!
    const cabin = this.cabin!
    const e = ride.r.e
    // Внутри кабины: шаг от двери вглубь; снаружи — площадка у двери.
    const inside = cabin.local(0, 0, -0.15)
    const yawIn = Math.atan2(e.door.x, e.door.z) // смотреть внутрь кабины (на заднюю стенку)
    const yawOut = Math.atan2(-e.door.x, -e.door.z) // смотреть на двери изнутри
    const STAGES = [0.7, 0.9, 1.3, 1.0, 0.9, ride.rideS, 0.9, 1.3]
    ride.time += dt
    const dur = STAGES[ride.stage]!
    const k = Math.min(1, ride.time / dur)
    const ek = easeInOut(k)
    const turnTo = (target: number): void => {
      const d = Math.atan2(Math.sin(target - ride.yawFrom), Math.cos(target - ride.yawFrom))
      t.yaw = ride.yawFrom + d * ek
    }
    t.pitch += (-TOUR_PITCH_DOWN * 0.5 - t.pitch) * (1 - Math.exp(-dt * 4))
    switch (ride.stage) {
      case 0: // повернуться к дверям лифта
        turnTo(yawIn)
        break
      case 1: // двери открываются
        cabin.setDoors(ek)
        break
      case 2: // войти
        ride.eye.lerpVectors(ride.from, inside.clone().setY(ride.from.y), ek)
        break
      case 3: // развернуться к дверям
        turnTo(yawOut)
        break
      case 4: // двери закрываются
        cabin.setDoors(1 - ek)
        break
      case 5: {
        // поездка
        const y = THREE.MathUtils.lerp(e.fromY, e.toY, ek)
        cabin.setY(y)
        ride.eye.y = y + TOUR_EYE_M
        break
      }
      case 6: // двери открываются на этаже назначения
        cabin.setDoors(ek)
        break
      case 7: {
        // выйти на площадку
        const exit = pointAt(t.path.pts, t.cum, ride.r.sTo).add(new THREE.Vector3(0, TOUR_EYE_M, 0))
        ride.eye.lerpVectors(ride.from, exit, ek)
        break
      }
    }
    if (k < 1) return
    ride.stage += 1
    ride.time = 0
    ride.from = ride.eye.clone()
    ride.yawFrom = t.yaw
    if (ride.stage < STAGES.length) return
    // Вышли: дальше пешком с площадки; кабину и шахты возвращаем, как были.
    t.s = ride.r.sTo
    t.ride = null
    t.rides = t.rides.filter((x) => x !== ride.r)
    this.endRide()
  }

  // ── Оформление маршрута ──────────────────────────────────────────────────────────

  private routeTex: THREE.CanvasTexture | null = null
  private pinTex: { from: THREE.CanvasTexture; to: THREE.CanvasTexture; key: string } | null = null

  private disposeRouteTextures(): void {
    this.routeTex?.dispose()
    this.routeTex = null
    this.pinTex?.from.dispose()
    this.pinTex?.to.dispose()
    this.pinTex = null
  }

  /**
   * Лента по полу (там, где её закрывают стены, — закрыта: путь идёт по коридорам и дверям,
   * а не сквозь них), по лестнице — вдоль марша; в шахте лифта ленты нет. На концах —
   * булавки А и Б. Текстуры живут между пересборками: иначе бегущие стрелки прыгали бы на
   * каждой догрузке этажа.
   */
  private buildRoute(
    route: RoutePoint[],
    floors: readonly SceneFloor[],
    labels: { from: string; to: string },
  ): void {
    const { pts, inShaft } = routePath(route, floors)
    if (pts.length < 2) return
    if (!this.routeTex) this.routeTex = ribbonTexture(this.palette.primary)
    const key = `${labels.from}|${labels.to}`
    if (this.pinTex?.key !== key) {
      this.pinTex?.from.dispose()
      this.pinTex?.to.dispose()
      this.pinTex = {
        from: pinTexture(labels.from, this.palette.start),
        to: pinTexture(labels.to, this.palette.end),
        key,
      }
    }
    const lifted = pts.map((p) => p.clone().setY(p.y + RIBBON_LIFT_M))
    const mat = this.material(
      new THREE.MeshBasicMaterial({
        map: this.routeTex,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    )
    // Куски ленты между шахтами: в шахте лифта ленты нет.
    let start = 0
    for (let i = 0; i <= inShaft.length; i++) {
      if (i < inShaft.length && !inShaft[i]) continue
      const part = lifted.slice(start, i + 1)
      if (part.length >= 2) {
        const ribbon = new THREE.Mesh(this.geometryRaw(ribbonGeometry(part, RIBBON_WIDTH_M)), mat)
        ribbon.renderOrder = 10
        this.content.add(ribbon)
      }
      start = i + 1
    }
    for (const [p, tex] of [
      [lifted[0]!, this.pinTex.from],
      [lifted[lifted.length - 1]!, this.pinTex.to],
    ] as const) {
      const pin = new THREE.Sprite(
        this.material(
          new THREE.SpriteMaterial({
            map: tex,
            depthTest: false,
            depthWrite: false,
            sizeAttenuation: false,
          }),
        ),
      )
      // Постоянный экранный размер; остриё хвостика — ровно в точке.
      pin.center.set(0.5, 0)
      pin.scale.set(0.045, 0.045 * 1.35, 1)
      pin.position.copy(p)
      pin.renderOrder = 12
      this.content.add(pin)
    }
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

  // ── Небо и территория ────────────────────────────────────────────────────────────

  private readonly sky: THREE.Mesh
  private site: { doc: SitePlanDoc; key: string; visual: SiteVisual } | null = null

  private makeSky(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(1, 32, 16)
    const zenith = new THREE.Color(SKY_ZENITH)
    const horizon = new THREE.Color(SKY_HORIZON)
    const below = new THREE.Color('#a9b39a')
    const colors: number[] = []
    const p = geo.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i)
      const c =
        y >= 0
          ? horizon.clone().lerp(zenith, Math.pow(y, 0.6))
          : horizon.clone().lerp(below, Math.min(1, -y * 4))
      colors.push(c.r, c.g, c.b)
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    const sky = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    )
    sky.renderOrder = -1
    sky.frustumCulled = false
    return sky
  }

  /**
   * Территория: строится, только когда сменилась она сама или корпуса (их контуры —
   * вырезы в земле); пересборка этажей и маршрута её не трогает.
   */
  private updateSite(input: SceneInput): void {
    if (!input.site) {
      this.site?.visual.dispose()
      this.site = null
      return
    }
    const outlines = new Map<string, Pt[]>()
    for (const f of input.floors) {
      if (outlines.has(f.buildingId) || !f.outline?.length) continue
      outlines.set(
        f.buildingId,
        f.outline.map((p) => (f.transform ? toCampus(p, f.transform) : p)),
      )
    }
    const rings = [...outlines.values()]
    const key = rings.map((r) => r.map((p) => `${p.x},${p.y}`).join(';')).join('|')
    if (this.site?.doc === input.site && this.site.key === key) return
    this.site?.visual.dispose()
    const all = [...input.site.boundary, ...rings.flat()]
    const xs = all.map((p) => p.x)
    const ys = all.map((p) => p.y)
    const extent = all.length
      ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 1000
      : 300
    const visual = buildSiteVisual(input.site, rings, extent)
    this.scene.add(visual.group)
    this.site = { doc: input.site, key, visual }
  }

  // ── Таблички у дверей ────────────────────────────────────────────────────────────

  /** Таблички этажей, построенные по требованию (ключ — этаж; план сменился — пересборка). */
  private readonly signs = new Map<string, { doc: SceneFloor['doc']; signs: DoorSigns | null }>()
  private static readonly SIGN_CACHE = 8

  /**
   * Таблички видны на этаже, где сейчас камера (внутри контура корпуса, по высоте между полом
   * и потолком): идущему по коридору — да, при взгляде сверху — нет, мелочь там не нужна.
   * Строятся при первом заходе на этаж, держим несколько последних.
   */
  private updateSigns(): void {
    const input = this.input
    const cam = this.camera.position
    const here = new Set<string>()
    if (input && input.mode !== 'campus') {
      for (const f of input.floors) {
        const y0 = f.elevationMm / 1000
        if (cam.y < y0 || cam.y > y0 + f.heightMm / 1000) continue
        if (!f.outline?.length) continue
        const ring = f.outline.map((p) => (f.transform ? toCampus(p, f.transform) : p))
        if (
          pointInPolygon({ x: Math.round(cam.x * 1000), y: Math.round(-cam.z * 1000) }, ring) ===
          'outside'
        )
          continue
        here.add(f.id)
      }
    }
    for (const id of here) {
      const f = input!.floors.find((x) => x.id === id)!
      const cached = this.signs.get(id)
      if (cached && cached.doc === f.doc) continue
      cached?.signs?.dispose()
      const labels = input!.kindLabels ?? {}
      const signs = buildDoorSigns(f, (k) => labels[k] ?? '')
      if (signs) this.scene.add(signs.group)
      this.signs.delete(id)
      this.signs.set(id, { doc: f.doc, signs })
    }
    for (const [id, entry] of this.signs) {
      if (entry.signs) entry.signs.group.visible = here.has(id)
    }
    // Лишние — самые давние (Map хранит порядок вставки).
    while (this.signs.size > CampusSceneController.SIGN_CACHE) {
      const [id, entry] = this.signs.entries().next().value!
      if (here.has(id)) break
      entry.signs?.dispose()
      this.signs.delete(id)
    }
  }

  dispose(): void {
    if (this.frame) cancelAnimationFrame(this.frame)
    for (const entry of this.signs.values()) entry.signs?.dispose()
    this.signs.clear()
    this.site?.visual.dispose()
    this.site = null
    this.sky.geometry.dispose()
    ;(this.sky.material as THREE.Material).dispose()
    this.clear()
    this.tour = null
    this.endRide()
    this.disposeRouteTextures()
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

  /** Готовая геометрия — в список на удаление при пересборке. */
  private geometryRaw(g: THREE.BufferGeometry): THREE.BufferGeometry {
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
    // Перекрытие чуть «отодвинуто» в глубину: пол помещений и торцы стен над ним всегда сверху.
    const slabMat = this.material(
      new THREE.MeshLambertMaterial({
        color: this.palette.slab,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 2,
      }),
    )
    // Лестницы — светлым камнем, шахты лифтов — тёмным металлом: видно сквозь окна и сверху.
    const stairsMat = this.material(new THREE.MeshLambertMaterial({ color: '#d6d3d1' }))
    const liftMat = this.material(new THREE.MeshLambertMaterial({ color: '#475569' }))
    // Потолок светлый: его видно изнутри (проход по маршруту), снизу он в тени — свет
    // полусферы сюда почти не доходит, поэтому свой тон, а не цвет плиты.
    const ceilingMat = this.material(new THREE.MeshBasicMaterial({ color: '#d7dce3' }))
    // Двери лифта — шлифованная сталь: блик от солнца отличает их от тёмной шахты.
    const liftDoorMat = this.material(
      new THREE.MeshPhongMaterial({ color: '#c3cad4', specular: '#ffffff', shininess: 70 }),
    )
    const liftLightMat = this.material(new THREE.MeshBasicMaterial({ color: '#fbbf24' }))
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

    // Проёмы: лестницы и шахты этажа ниже того же корпуса поднимаются сюда — в полу и плите
    // над ними дыра, иначе путь по лестнице и в лифте упирался бы в потолок.
    const below = (f: SceneFloor): SceneFloor | null =>
      input.floors.reduce<SceneFloor | null>(
        (best, x) =>
          x.buildingId === f.buildingId &&
          x.elevationMm < f.elevationMm &&
          (!best || x.elevationMm > best.elevationMm)
            ? x
            : best,
        null,
      )
    // Этаж над данным (того же корпуса) среди видимых — его плита даёт потолок.
    const above = (f: SceneFloor): SceneFloor | null =>
      visible.reduce<SceneFloor | null>(
        (best, x) =>
          x.buildingId === f.buildingId &&
          x.elevationMm > f.elevationMm &&
          (!best || x.elevationMm < best.elevationMm)
            ? x
            : best,
        null,
      )
    this.shaftMeshes.length = 0
    for (const f of visible) {
      const under = below(f)
      // Высота марша — высота этажа ниже: от неё зависит раскладка лестницы, а с ней и проём.
      const openings = under
        ? Object.values(under.doc.verticals).map((v) => verticalOpening(v, under.heightMm / 1000))
        : []
      const opts = {
        elevationMm: f.elevationMm,
        heightMm: f.heightMm,
        transform: f.transform,
        openings,
      }
      const mesh = cachedFloorMesh(f.doc, opts)
      const walls = new THREE.Mesh(this.geometry(mesh.walls), wallMat)
      this.content.add(walls)
      if (mesh.glass.indices.length)
        this.content.add(new THREE.Mesh(this.geometry(mesh.glass), glassMat))
      if (mesh.stairs.indices.length)
        this.content.add(new THREE.Mesh(this.geometry(mesh.stairs), stairsMat))
      // Шахта и её лицо на этаже (двери, рамка, табло). В поездке прячутся: кабина стоит на
      // их месте, а глухая коробка и закрытые двери заслонили бы её.
      for (const [buf, mat] of [
        [mesh.elevators, liftMat],
        [mesh.liftDoors, liftDoorMat],
        [mesh.liftLights, liftLightMat],
      ] as const) {
        if (!buf.indices.length) continue
        const part = new THREE.Mesh(this.geometry(buf), mat)
        part.visible = !this.cabin
        this.shaftMeshes.push(part)
        this.content.add(part)
      }
      for (const [kind, buf] of Object.entries(mesh.floors)) {
        const floor = new THREE.Mesh(this.geometry(buf!), kindMat(kind as SpaceKind | 'none'))
        floor.userData.floorId = f.id
        this.pickables.push(floor)
        this.content.add(floor)
      }
      if (f.outline?.length) {
        this.content.add(
          new THREE.Mesh(
            this.geometry(slabMesh(f.outline, f.elevationMm, 150, f.transform, openings)),
            slabMat,
          ),
        )
        // Потолок — у каждого видимого этажа: низ плиты этажа выше, а если его нет (верхний
        // этаж корпуса или верх срезан уровнем показа) — на высоте этажа. Лицом вниз: сверху
        // («кукольный домик») его не видно, изнутри видно. Над лестницами и шахтами этого
        // этажа — проёмы, как в плите над ними.
        const over = above(f)
        const own = Object.values(f.doc.verticals).map((v) => verticalOpening(v, f.heightMm / 1000))
        this.content.add(
          new THREE.Mesh(
            this.geometry(
              ceilingMesh(
                f.outline,
                over ? over.elevationMm : f.elevationMm + f.heightMm,
                150,
                f.transform,
                own,
              ),
            ),
            ceilingMat,
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

    if (input.route && input.route.length > 1)
      this.buildRoute(input.route, input.floors, input.routeMarkers ?? { from: 'A', to: 'B' })

    this.updateSite(input)
    this.requestRender()
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
    // Выбор — только левой кнопкой: правой вращают, и щелчок ею помещение не выбирает.
    if (e.button !== 0) return
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
