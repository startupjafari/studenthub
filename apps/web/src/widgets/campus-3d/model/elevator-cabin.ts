import * as THREE from 'three'
import type { RouteElevator } from './route-path'

/** Этаж корпуса для кнопок кабины. */
export interface CabinFloor {
  id: string
  label: string
  /** Отметка пола, м сцены. */
  y: number
}

const CABIN_H = 2.4
const DOOR_H = 2.1
const WALL = 0.04
const PANEL_W = 0.22
const PANEL_H = 0.5

/**
 * Кабина лифта для прохода по маршруту (docs/CAMPUS_BUILDER.md §15): стены, раздвижные
 * двери, панель с кнопками этажей корпуса (кнопка этажа назначения горит) и табло над
 * дверью с текущим этажом и стрелкой. Локальные оси: +Z — наружу через дверь, X — вдоль двери.
 * Живёт вне `content` сцены: пересборка этажей на ходу её не трогает.
 */
export class ElevatorCabin {
  readonly group = new THREE.Group()
  private readonly doors: THREE.Mesh[] = []
  private readonly doorWidth: number
  private readonly disposables: { dispose: () => void }[] = []
  private readonly panelCanvas = document.createElement('canvas')
  private readonly panelTex: THREE.CanvasTexture
  private readonly boardCanvas = document.createElement('canvas')
  private readonly boardTex: THREE.CanvasTexture
  private shown = ''

  constructor(
    readonly info: RouteElevator,
    private readonly floors: CabinFloor[],
    private readonly target: string | null,
    private readonly accent: string,
  ) {
    const width = Math.max(1, info.halfWidth * 2 - 0.1)
    const depth = Math.max(1, info.halfDepth * 2 - 0.1)
    this.doorWidth = Math.min(1, width * 0.62)
    const g = this.group
    g.position.set(info.center.x, info.fromY, info.center.z)
    g.rotation.y = Math.atan2(info.door.x, info.door.z)

    const wallMat = this.mat(
      new THREE.MeshLambertMaterial({ color: '#a7b0bd', side: THREE.DoubleSide }),
    )
    const doorMat = this.mat(new THREE.MeshLambertMaterial({ color: '#cfd5dd' }))
    const floorMat = this.mat(new THREE.MeshLambertMaterial({ color: '#4b5563' }))
    const lightMat = this.mat(new THREE.MeshBasicMaterial({ color: '#f8fafc' }))
    const box = (
      w: number,
      h: number,
      d: number,
      m: THREE.Material,
      x: number,
      y: number,
      z: number,
    ) => {
      const geo = new THREE.BoxGeometry(w, h, d)
      this.disposables.push(geo)
      const mesh = new THREE.Mesh(geo, m)
      mesh.position.set(x, y, z)
      g.add(mesh)
      return mesh
    }
    const hw = width / 2
    const hd = depth / 2
    box(width, 0.04, depth, floorMat, 0, 0.02, 0)
    box(width, 0.04, depth, lightMat, 0, CABIN_H, 0)
    box(width, CABIN_H, WALL, wallMat, 0, CABIN_H / 2, -hd)
    box(WALL, CABIN_H, depth, wallMat, -hw, CABIN_H / 2, 0)
    box(WALL, CABIN_H, depth, wallMat, hw, CABIN_H / 2, 0)
    // Передняя стенка — вокруг дверного проёма.
    const dw = this.doorWidth
    const sideW = (width - dw) / 2
    box(sideW, CABIN_H, WALL, wallMat, -(dw / 2 + sideW / 2), CABIN_H / 2, hd)
    box(sideW, CABIN_H, WALL, wallMat, dw / 2 + sideW / 2, CABIN_H / 2, hd)
    box(dw, CABIN_H - DOOR_H, WALL, wallMat, 0, (CABIN_H + DOOR_H) / 2, hd)
    // Створки — чуть внутри проёма, уезжают в стороны за стенку.
    for (const sign of [-1, 1]) {
      this.doors.push(box(dw / 2, DOOR_H, 0.03, doorMat, (sign * dw) / 4, DOOR_H / 2, hd - 0.04))
    }

    // Панель кнопок — на передней стенке изнутри, справа от двери; табло — над дверью.
    this.panelCanvas.width = 128
    this.panelCanvas.height = Math.round((128 * PANEL_H) / PANEL_W)
    this.panelTex = new THREE.CanvasTexture(this.panelCanvas)
    this.panelTex.colorSpace = THREE.SRGBColorSpace
    this.disposables.push(this.panelTex)
    const panel = new THREE.Mesh(
      this.geo(new THREE.PlaneGeometry(PANEL_W, PANEL_H)),
      this.mat(new THREE.MeshBasicMaterial({ map: this.panelTex })),
    )
    panel.position.set(Math.min(hw - 0.15, dw / 2 + sideW / 2), 1.25, hd - WALL / 2 - 0.005)
    panel.rotation.y = Math.PI
    g.add(panel)

    this.boardCanvas.width = 192
    this.boardCanvas.height = 72
    this.boardTex = new THREE.CanvasTexture(this.boardCanvas)
    this.boardTex.colorSpace = THREE.SRGBColorSpace
    this.disposables.push(this.boardTex)
    const board = new THREE.Mesh(
      this.geo(new THREE.PlaneGeometry(0.4, 0.15)),
      this.mat(new THREE.MeshBasicMaterial({ map: this.boardTex })),
    )
    board.position.set(0, DOOR_H + (CABIN_H - DOOR_H) / 2, hd - WALL / 2 - 0.005)
    board.rotation.y = Math.PI
    g.add(board)

    this.drawPanel()
    this.setY(info.fromY)
  }

  /** Точка в кабине (локальные x, z) → мир; y — от пола кабины. */
  local(x: number, y: number, z: number): THREE.Vector3 {
    return this.group.localToWorld(new THREE.Vector3(x, y, z))
  }

  /** 0 — закрыты, 1 — открыты. */
  setDoors(open: number): void {
    const dw = this.doorWidth
    this.doors.forEach((d, i) => {
      const sign = i === 0 ? -1 : 1
      d.position.x = sign * (dw / 4 + (dw / 2) * 0.92 * open)
    })
  }

  /** Пол кабины на высоте `y`; табло показывает ближайший этаж и направление. */
  setY(y: number): void {
    this.group.position.y = y
    this.group.updateMatrixWorld()
    const near = this.floors.reduce<CabinFloor | null>(
      (best, f) => (!best || Math.abs(f.y - y) < Math.abs(best.y - y) ? f : best),
      null,
    )
    const dir =
      Math.abs(y - this.info.toY) < 0.02 ? '' : this.info.toY > this.info.fromY ? '▲' : '▼'
    const text = `${dir} ${near?.label ?? ''}`.trim()
    if (text === this.shown) return
    this.shown = text
    const c = this.boardCanvas.getContext('2d')!
    c.fillStyle = '#0b0f14'
    c.fillRect(0, 0, c.canvas.width, c.canvas.height)
    c.fillStyle = '#fbbf24'
    c.font = 'bold 46px system-ui, sans-serif'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(text, c.canvas.width / 2, c.canvas.height / 2 + 2)
    this.boardTex.needsUpdate = true
  }

  /** Кнопки этажей корпуса снизу вверх, в два столбца; кнопка назначения горит. */
  private drawPanel(): void {
    const c = this.panelCanvas.getContext('2d')!
    const W = c.canvas.width
    const H = c.canvas.height
    c.fillStyle = '#8b95a3'
    c.fillRect(0, 0, W, H)
    c.fillStyle = '#6b7482'
    c.fillRect(6, 6, W - 12, H - 12)
    const list = [...this.floors].sort((a, b) => a.y - b.y)
    const cols = list.length > 6 ? 2 : 1
    const rows = Math.ceil(list.length / cols)
    const cell = Math.min((W - 24) / cols, (H - 24) / Math.max(1, rows))
    const r = cell * 0.36
    list.forEach((f, i) => {
      const col = cols === 2 ? i % 2 : 0
      const row = cols === 2 ? Math.floor(i / 2) : i
      const x = cols === 2 ? W / 2 + (col === 0 ? -1 : 1) * (cell / 2 + 2) : W / 2
      const y = H - 12 - cell / 2 - row * cell
      const on = f.id === this.target
      c.beginPath()
      c.arc(x, y, r, 0, Math.PI * 2)
      c.fillStyle = on ? this.accent : '#e5e7eb'
      c.fill()
      c.lineWidth = on ? 4 : 2
      c.strokeStyle = on ? '#ffffff' : '#9ca3af'
      c.stroke()
      c.fillStyle = on ? '#ffffff' : '#1f2937'
      c.font = `bold ${Math.round(r * 0.95)}px system-ui, sans-serif`
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillText(f.label, x, y + 1)
    })
    this.panelTex.needsUpdate = true
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.disposables.push(g)
    return g
  }

  private mat<T extends THREE.Material>(m: T): T {
    this.disposables.push(m)
    return m
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const d of this.disposables) d.dispose()
  }
}
