import * as THREE from 'three'
import { liftDoorWidth } from '@studenthub/campus-core/mesh'
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
const PANEL_W = 0.24
const PANEL_H = 0.62
const RAIL_Y = 0.92

/**
 * Кабина лифта для прохода по маршруту (docs/CAMPUS_BUILDER.md §15): стальные панели со
 * швами, зеркало на задней стене, поручень, светильник в потолке, пол с окантовкой и порог,
 * раздвижные двери с рамкой. Панель управления: экран с этажом и стрелкой, кнопки этажей
 * корпуса (кнопка назначения горит), «открыть» и «закрыть», вызов диспетчера; над дверью —
 * табло. Локальные оси: +Z — наружу через дверь, X — вдоль двери.
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
    this.doorWidth = liftDoorWidth(info.halfWidth * 2)
    const g = this.group
    g.position.set(info.center.x, info.fromY, info.center.z)
    g.rotation.y = Math.atan2(info.door.x, info.door.z)

    const steel = this.mat(
      new THREE.MeshPhongMaterial({
        color: '#b9c1cc',
        specular: '#ffffff',
        shininess: 60,
        side: THREE.DoubleSide,
      }),
    )
    const brushed = this.mat(
      new THREE.MeshPhongMaterial({ color: '#d5dbe3', specular: '#ffffff', shininess: 90 }),
    )
    const mirror = this.mat(
      new THREE.MeshPhongMaterial({ color: '#dbe6f0', specular: '#ffffff', shininess: 140 }),
    )
    const seam = this.mat(new THREE.MeshBasicMaterial({ color: '#6b7280' }))
    const floorMat = this.mat(new THREE.MeshLambertMaterial({ color: '#2f3640' }))
    const floorEdge = this.mat(new THREE.MeshLambertMaterial({ color: '#8b95a3' }))
    const ceiling = this.mat(new THREE.MeshLambertMaterial({ color: '#e5e7eb' }))
    const light = this.mat(new THREE.MeshBasicMaterial({ color: '#fffdf5' }))

    const box = (
      w: number,
      h: number,
      d: number,
      m: THREE.Material,
      x: number,
      y: number,
      z: number,
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, h, d)), m)
      mesh.position.set(x, y, z)
      g.add(mesh)
      return mesh
    }
    const hw = width / 2
    const hd = depth / 2
    const dw = this.doorWidth

    // Пол: тёмный камень с окантовкой; потолок со светильником и свет внутри.
    box(width, 0.04, depth, floorEdge, 0, 0.02, 0)
    box(width - 0.16, 0.042, depth - 0.16, floorMat, 0, 0.022, 0)
    box(width, 0.04, depth, ceiling, 0, CABIN_H, 0)
    box(Math.min(0.9, width - 0.4), 0.01, Math.min(0.9, depth - 0.4), light, 0, CABIN_H - 0.025, 0)
    const lamp = new THREE.PointLight('#fff7e6', 1.1, 4.5, 2)
    lamp.position.set(0, CABIN_H - 0.3, 0)
    g.add(lamp)

    // Стены — сталь; задняя — зеркало в рамке над поручнем.
    box(width, CABIN_H, WALL, steel, 0, CABIN_H / 2, -hd)
    box(WALL, CABIN_H, depth, steel, -hw, CABIN_H / 2, 0)
    box(WALL, CABIN_H, depth, steel, hw, CABIN_H / 2, 0)
    box(width - 0.3, 1.15, 0.01, mirror, 0, 1.6, -hd + WALL / 2 + 0.006)
    // Швы панелей на боковых стенах.
    for (const sx of [-1, 1]) {
      for (let z = -hd + 0.5; z < hd - 0.2; z += 0.5) {
        box(0.004, CABIN_H - 0.1, 0.008, seam, sx * (hw - WALL / 2 - 0.003), CABIN_H / 2, z)
      }
    }
    // Поручень по задней и боковым стенам на кронштейнах.
    const rail = (len: number, x: number, z: number, along: 'x' | 'z'): void => {
      const geo = this.geo(new THREE.CylinderGeometry(0.02, 0.02, len, 10))
      const m = new THREE.Mesh(geo, brushed)
      m.position.set(x, RAIL_Y, z)
      if (along === 'x') m.rotation.z = Math.PI / 2
      else m.rotation.x = Math.PI / 2
      g.add(m)
    }
    const inset = WALL / 2 + 0.06
    rail(width - 0.3, 0, -hd + inset, 'x')
    rail(depth - 0.5, -hw + inset, -0.1, 'z')
    rail(depth - 0.5, hw - inset, -0.1, 'z')

    // Передняя стенка вокруг дверного проёма, рамка проёма, порог.
    const sideW = (width - dw) / 2
    box(sideW, CABIN_H, WALL, steel, -(dw / 2 + sideW / 2), CABIN_H / 2, hd)
    box(sideW, CABIN_H, WALL, steel, dw / 2 + sideW / 2, CABIN_H / 2, hd)
    box(dw, CABIN_H - DOOR_H, WALL, steel, 0, (CABIN_H + DOOR_H) / 2, hd)
    // Рамка проёма — тёмная сталь: створки на её фоне читаются дверью, а не стеной.
    const frameMat = this.mat(
      new THREE.MeshPhongMaterial({ color: '#5b6573', specular: '#ffffff', shininess: 50 }),
    )
    for (const sx of [-1, 1])
      box(0.06, DOOR_H + 0.06, WALL + 0.03, frameMat, sx * (dw / 2 + 0.03), (DOOR_H + 0.06) / 2, hd)
    box(dw + 0.12, 0.06, WALL + 0.03, frameMat, 0, DOOR_H + 0.03, hd)
    box(dw, 0.012, 0.1, brushed, 0, 0.046, hd - 0.02)
    // Створки — шлифованная сталь с вертикальной фактурой и тёмной резиновой кромкой там,
    // где они смыкаются: закрытая дверь видна дверью. Уезжают в стороны за стенку.
    for (const sign of [-1, 1]) {
      const leaf = this.mat(
        new THREE.MeshPhongMaterial({
          map: this.doorTexture(sign),
          specular: '#ffffff',
          shininess: 80,
        }),
      )
      this.doors.push(
        box(dw / 2 - 0.004, DOOR_H, 0.03, leaf, (sign * dw) / 4, DOOR_H / 2, hd - 0.045),
      )
    }

    // Панель управления — на передней стенке изнутри, сбоку от двери; табло — над дверью.
    this.panelCanvas.width = 192
    this.panelCanvas.height = Math.round((192 * PANEL_H) / PANEL_W)
    this.panelTex = new THREE.CanvasTexture(this.panelCanvas)
    this.panelTex.colorSpace = THREE.SRGBColorSpace
    this.panelTex.anisotropy = 4
    this.disposables.push(this.panelTex)
    const panel = new THREE.Mesh(
      this.geo(new THREE.PlaneGeometry(PANEL_W, PANEL_H)),
      this.mat(new THREE.MeshBasicMaterial({ map: this.panelTex })),
    )
    panel.position.set(
      Math.min(hw - PANEL_W / 2 - 0.06, dw / 2 + sideW / 2),
      1.2,
      hd - WALL / 2 - 0.006,
    )
    panel.rotation.y = Math.PI
    g.add(panel)

    this.boardCanvas.width = 256
    this.boardCanvas.height = 80
    this.boardTex = new THREE.CanvasTexture(this.boardCanvas)
    this.boardTex.colorSpace = THREE.SRGBColorSpace
    this.disposables.push(this.boardTex)
    const board = new THREE.Mesh(
      this.geo(new THREE.PlaneGeometry(0.42, 0.13)),
      this.mat(new THREE.MeshBasicMaterial({ map: this.boardTex })),
    )
    board.position.set(0, DOOR_H + 0.15, hd - WALL / 2 - 0.006)
    board.rotation.y = Math.PI
    g.add(board)

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
      d.position.x = sign * (dw / 4 + (dw / 2) * 0.95 * open)
    })
  }

  /** Пол кабины на высоте `y`; табло и экран панели — ближайший этаж и направление. */
  setY(y: number): void {
    this.group.position.y = y
    this.group.updateMatrixWorld()
    const near = this.floors.reduce<CabinFloor | null>(
      (best, f) => (!best || Math.abs(f.y - y) < Math.abs(best.y - y) ? f : best),
      null,
    )
    const dir =
      Math.abs(y - this.info.toY) < 0.02 ? '' : this.info.toY > this.info.fromY ? '▲' : '▼'
    const label = near?.label ?? ''
    const text = `${dir} ${label}`.trim()
    if (text === this.shown) return
    this.shown = text
    const c = this.boardCanvas.getContext('2d')!
    c.fillStyle = '#0b0f14'
    c.fillRect(0, 0, c.canvas.width, c.canvas.height)
    c.fillStyle = '#fbbf24'
    c.font = 'bold 52px system-ui, sans-serif'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(text, c.canvas.width / 2, c.canvas.height / 2 + 2)
    this.boardTex.needsUpdate = true
    this.drawPanel(label, dir)
  }

  /**
   * Панель: экран сверху (этаж и стрелка), кнопки этажей снизу вверх в два столбца — кнопка
   * назначения горит, ниже «открыть», «закрыть» и вызов диспетчера.
   */
  private drawPanel(current: string, dir: string): void {
    const c = this.panelCanvas.getContext('2d')!
    const W = c.canvas.width
    const H = c.canvas.height
    // Шлифованная сталь: тонкие горизонтальные штрихи.
    c.fillStyle = '#aeb6c2'
    c.fillRect(0, 0, W, H)
    for (let y = 0; y < H; y += 3) {
      c.fillStyle = y % 6 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'
      c.fillRect(0, y, W, 1)
    }
    c.strokeStyle = '#7b8494'
    c.lineWidth = 4
    c.strokeRect(2, 2, W - 4, H - 4)

    // Экран.
    const sx = 22
    const sy = 18
    const sw = W - 44
    const sh = 70
    c.fillStyle = '#05080c'
    c.fillRect(sx, sy, sw, sh)
    c.fillStyle = '#fbbf24'
    c.font = 'bold 44px system-ui, sans-serif'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(`${dir} ${current}`.trim(), W / 2, sy + sh / 2 + 2)

    // Кнопки этажей.
    const list = [...this.floors].sort((a, b) => a.y - b.y)
    const cols = list.length > 6 ? 2 : 1
    const rows = Math.ceil(list.length / cols)
    const areaTop = sy + sh + 24
    const areaBottom = H - 120
    const cell = Math.min((W - 40) / cols, (areaBottom - areaTop) / Math.max(1, rows))
    const r = cell * 0.36
    const button = (x: number, y: number, on: boolean): void => {
      c.beginPath()
      c.arc(x, y, r + 3, 0, Math.PI * 2)
      c.fillStyle = '#6b7482'
      c.fill()
      c.beginPath()
      c.arc(x, y, r, 0, Math.PI * 2)
      c.fillStyle = on ? this.accent : '#eef1f5'
      c.fill()
      if (on) {
        c.lineWidth = 4
        c.strokeStyle = '#ffffff'
        c.stroke()
      }
    }
    list.forEach((f, i) => {
      const col = cols === 2 ? i % 2 : 0
      const row = cols === 2 ? Math.floor(i / 2) : i
      const x = cols === 2 ? W / 2 + (col === 0 ? -1 : 1) * (cell / 2 + 2) : W / 2
      const y = areaBottom - cell / 2 - row * cell
      const on = f.id === this.target
      button(x, y, on)
      c.fillStyle = on ? '#ffffff' : '#1f2937'
      c.font = `bold ${Math.round(r * 0.95)}px system-ui, sans-serif`
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillText(f.label, x, y + 1)
    })

    // «Открыть», «закрыть», вызов — нижний ряд.
    const by = H - 62
    const bx = [W / 2 - 52, W / 2, W / 2 + 52]
    const br = 20
    bx.forEach((x) => {
      c.beginPath()
      c.arc(x, by, br + 3, 0, Math.PI * 2)
      c.fillStyle = '#6b7482'
      c.fill()
      c.beginPath()
      c.arc(x, by, br, 0, Math.PI * 2)
      c.fillStyle = '#eef1f5'
      c.fill()
    })
    const tri = (x: number, y: number, pointRight: boolean): void => {
      const d = pointRight ? 1 : -1
      c.beginPath()
      c.moveTo(x - 5 * d, y - 7)
      c.lineTo(x + 5 * d, y)
      c.lineTo(x - 5 * d, y + 7)
      c.closePath()
      c.fill()
    }
    c.fillStyle = '#1f2937'
    // ◀|▶ — открыть, ▶|◀ — закрыть.
    tri(bx[0]! - 7, by, false)
    tri(bx[0]! + 7, by, true)
    c.fillRect(bx[0]! - 1, by - 8, 2, 16)
    tri(bx[1]! - 8, by, true)
    tri(bx[1]! + 8, by, false)
    c.fillRect(bx[1]! - 1, by - 8, 2, 16)
    // Вызов диспетчера — жёлтая кнопка с колокольчиком.
    c.beginPath()
    c.arc(bx[2]!, by, br, 0, Math.PI * 2)
    c.fillStyle = '#facc15'
    c.fill()
    c.fillStyle = '#1f2937'
    c.beginPath()
    c.arc(bx[2]!, by - 1, 8, Math.PI, 0)
    c.lineTo(bx[2]! + 10, by + 6)
    c.lineTo(bx[2]! - 10, by + 6)
    c.closePath()
    c.fill()
    c.beginPath()
    c.arc(bx[2]!, by + 9, 3, 0, Math.PI * 2)
    c.fill()
    this.panelTex.needsUpdate = true
  }

  /** Фактура створки: вертикальные штрихи стали, у кромки смыкания — тёмная резина. */
  private doorTexture(sign: number): THREE.CanvasTexture {
    const c = document.createElement('canvas')
    c.width = 128
    c.height = 256
    const g = c.getContext('2d')!
    const grad = g.createLinearGradient(0, 0, 128, 0)
    grad.addColorStop(0, '#c9d0d9')
    grad.addColorStop(0.5, '#dde3ea')
    grad.addColorStop(1, '#c3cad4')
    g.fillStyle = grad
    g.fillRect(0, 0, 128, 256)
    for (let x = 0; x < 128; x += 2) {
      g.fillStyle = x % 4 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.05)'
      g.fillRect(x, 0, 1, 256)
    }
    // Кромка смыкания — со стороны середины проёма.
    g.fillStyle = '#2b3139'
    g.fillRect(sign < 0 ? 122 : 0, 0, 6, 256)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    this.disposables.push(t)
    return t
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
