import * as THREE from 'three'

/**
 * Маршрут в 3D «как в 2ГИС» (docs/CAMPUS_BUILDER.md §15): плоская лента по полу с тёмной
 * каймой и белыми стрелками по ходу движения, А и Б — булавки постоянного экранного размера.
 * Сам путь (марши, шахты, углы) собирает `route-path.ts`.
 */

/** Ширина ленты, м. */
export const RIBBON_WIDTH_M = 0.6
/** Шаг стрелок вдоль ленты, м (одна плитка текстуры). */
export const ARROW_STEP_M = 2.4

/** Накопленная длина по точкам пути, м. */
export function pathLengths(pts: THREE.Vector3[]): number[] {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!))
  return cum
}

/** Точка пути на расстоянии `s` от начала. */
export function pointAt(pts: THREE.Vector3[], cum: number[], s: number): THREE.Vector3 {
  let lo = 0
  let hi = cum.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid]! <= s) lo = mid
    else hi = mid
  }
  const seg = cum[hi]! - cum[lo]!
  const k = seg > 0 ? THREE.MathUtils.clamp((s - cum[lo]!) / seg, 0, 1) : 0
  return pts[lo]!.clone().lerp(pts[hi]!, k)
}

/**
 * Лента вдоль пути: по паре вершин на точку, поперёк — горизонтальная нормаль к среднему
 * направлению соседних отрезков. На вертикальном участке (лифт) нормаль берём прежнюю.
 * U — пройденные метры / шаг стрелок: текстура повторяется вдоль, стрелки смотрят по ходу.
 */
export function ribbonGeometry(pts: THREE.Vector3[], width: number): THREE.BufferGeometry {
  const cum = pathLengths(pts)
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  let side = new THREE.Vector3(1, 0, 0)
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)]!
    const next = pts[Math.min(pts.length - 1, i + 1)]!
    const dir = next.clone().sub(prev).setY(0)
    if (dir.lengthSq() > 1e-6) side = new THREE.Vector3(-dir.z, 0, dir.x).normalize()
    const p = pts[i]!
    const h = width / 2
    pos.push(p.x + side.x * h, p.y, p.z + side.z * h, p.x - side.x * h, p.y, p.z - side.z * h)
    const u = cum[i]! / ARROW_STEP_M
    uv.push(u, 1, u, 0)
    if (i > 0) {
      const a = (i - 1) * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}

/** Плитка ленты: кайма темнее основы, по центру белая стрелка «›» острием вдоль U. */
export function ribbonTexture(color: string): THREE.CanvasTexture {
  const w = 128
  const h = 64
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  const base = new THREE.Color(color)
  const edge = base.clone().multiplyScalar(0.55)
  g.fillStyle = `#${edge.getHexString()}`
  g.fillRect(0, 0, w, h)
  g.fillStyle = `#${base.getHexString()}`
  g.fillRect(0, h * 0.16, w, h * 0.68)
  g.strokeStyle = 'rgba(255,255,255,0.95)'
  g.lineWidth = 7
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.beginPath()
  g.moveTo(w * 0.4, h * 0.3)
  g.lineTo(w * 0.58, h * 0.5)
  g.lineTo(w * 0.4, h * 0.7)
  g.stroke()
  const t = new THREE.CanvasTexture(c)
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.ClampToEdgeWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** Булавка А/Б: круг с буквой и хвостиком вниз, белая обводка — читается на любом фоне. */
export function pinTexture(letter: string, color: string): THREE.CanvasTexture {
  const s = 128
  const c = document.createElement('canvas')
  c.width = s
  c.height = s * 1.35
  const g = c.getContext('2d')!
  const cx = s / 2
  const cy = s * 0.48
  const r = s * 0.36
  g.beginPath()
  g.moveTo(cx - r * 0.45, cy + r * 0.85)
  g.lineTo(cx, c.height - 4)
  g.lineTo(cx + r * 0.45, cy + r * 0.85)
  g.closePath()
  g.fillStyle = '#ffffff'
  g.fill()
  g.beginPath()
  g.arc(cx, cy, r + 7, 0, Math.PI * 2)
  g.fill()
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.fillStyle = color
  g.fill()
  g.fillStyle = '#ffffff'
  g.font = `bold ${Math.round(r * 1.1)}px system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(letter, cx, cy + 2)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
