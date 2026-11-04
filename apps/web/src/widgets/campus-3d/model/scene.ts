import * as THREE from 'three'
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
  type MeshBuffers,
} from '@studenthub/campus-core/mesh'
import { SPACE_KIND_COLOR } from '../../../entities/campus'

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
 * Режимы обзора (§13.4): этаж — только выбранный, без потолка; корпус — этажи до выбранного
 * включительно, выше — скрыты («кукольный домик»); кампус — корпуса коробками по контуру,
 * без внутренних стен: на 20 корпусах это десятки draw calls вместо сотен.
 */
export type SceneMode = 'floor' | 'building' | 'campus'

export interface SceneInput {
  floors: SceneFloor[]
  mode: SceneMode
  focusFloorId: string | null
  highlight: { floorId: string; spaceId: string } | null
  /** Маршрут в метрах сцены (x, y, z). */
  route: { x: number; y: number; z: number }[] | null
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
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = false
    this.controls.maxPolarAngle = Math.PI * 0.49
    this.controls.screenSpacePanning = true
    this.controls.addEventListener('change', () => this.requestRender())

    this.renderer.domElement.addEventListener('webglcontextlost', this.lost)
    this.renderer.domElement.addEventListener('webglcontextrestored', this.restored)
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown)
    this.renderer.domElement.addEventListener('pointerup', this.pointerUp)
  }

  setPalette(p: ScenePalette): void {
    this.palette = p
    this.scene.background = new THREE.Color(p.background)
    if (this.input) this.rebuild()
  }

  update(input: SceneInput): void {
    const refit =
      !this.input ||
      this.input.mode !== input.mode ||
      this.input.focusFloorId !== input.focusFloorId
    this.input = input
    this.rebuild()
    if (refit || !this.fitted) this.fit()
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

  /** Камера на всё содержимое сцены сверху-сбоку. */
  fit(): void {
    const box = new THREE.Box3().setFromObject(this.content)
    if (box.isEmpty()) return
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const r = Math.max(size.x, size.z, size.y * 2, 5)
    this.camera.near = Math.max(0.1, r / 500)
    this.camera.far = r * 20
    this.camera.updateProjectionMatrix()
    this.camera.position.set(center.x + r * 0.7, center.y + r * 0.9, center.z + r * 0.95)
    this.controls.target.copy(center)
    this.controls.update()
    this.fitted = true
    this.requestRender()
  }

  /** Подвести камеру к точке (найденное помещение, начало маршрута). */
  focusOn(x: number, y: number, z: number, distance = 25): void {
    const target = new THREE.Vector3(x, y, z)
    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    this.controls.target.copy(target)
    this.camera.position.copy(target.clone().add(dir.multiplyScalar(distance)))
    this.controls.update()
    this.requestRender()
  }

  requestRender(): void {
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0
        this.renderer.render(this.scene, this.camera)
      })
  }

  dispose(): void {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.clear()
    this.controls.dispose()
    const el = this.renderer.domElement
    el.removeEventListener('webglcontextlost', this.lost)
    el.removeEventListener('webglcontextrestored', this.restored)
    el.removeEventListener('pointerdown', this.pointerDown)
    el.removeEventListener('pointerup', this.pointerUp)
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
    const visible = input.floors.filter((f) => {
      if (input.mode === 'campus') return false
      if (input.mode === 'floor') return f.id === focus?.id
      // Корпус: этажи того же корпуса до выбранного включительно.
      return !focus || (f.buildingId === focus.buildingId && f.level <= focus.level)
    })

    for (const f of visible) {
      const opts = { elevationMm: f.elevationMm, heightMm: f.heightMm, transform: f.transform }
      const mesh = floorMesh(f.doc, opts)
      const walls = new THREE.Mesh(this.geometry(mesh.walls), wallMat)
      this.content.add(walls)
      if (mesh.glass.indices.length)
        this.content.add(new THREE.Mesh(this.geometry(mesh.glass), glassMat))
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
      for (const floors of byBuilding.values()) {
        const outline = floors[0]?.outline
        if (!outline?.length) continue
        const bottom = Math.min(...floors.map((f) => f.elevationMm))
        const top = Math.max(...floors.map((f) => f.elevationMm + f.heightMm))
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
  }

  /** Клик без перетаскивания — выбор помещения под курсором. */
  private readonly pointerUp = (e: PointerEvent): void => {
    const d = this.down
    this.down = null
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || !this.onPick || !this.input)
      return
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, this.camera)
    const hit = ray.intersectObjects(this.pickables, false)[0]
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
  }

  private readonly restored = (): void => {
    this.onContextLost?.(false)
    this.rebuild()
  }
}
