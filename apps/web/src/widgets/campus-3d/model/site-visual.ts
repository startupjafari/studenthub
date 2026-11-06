import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  pointInPolygon,
  type Pt,
  type SiteFeature,
  type SitePlanDoc,
} from '@studenthub/campus-core'

/**
 * Территория в 3D (docs/CAMPUS_BUILDER.md §14) — так, чтобы пройти по ней от первого лица
 * было похоже на улицу: земля до горизонта (с вырезами под корпуса — подвалы видно сверху),
 * газоны, плитка дорожек с бордюрами, асфальт с разметкой, резина площадок; деревья со
 * стволом и кроной разной формы и оттенка, фонари вдоль дорожек, скамейки в зонах отдыха,
 * ворота со столбами и табличкой, ограда по границе территории.
 *
 * Фактуры процедурные (canvas, повторяются по метрам), всё повторяющееся — InstancedMesh:
 * сотни деревьев и фонарей остаются десятком draw calls. Случайность — от координат:
 * перерисовка не «перетасовывает» деревья.
 */

export interface SiteVisual {
  group: THREE.Group
  dispose: () => void
}

/** Псевдослучайное 0…1 от двух чисел — стабильно между перерисовками. */
function hash(a: number, b: number, salt = 0): number {
  const s = Math.sin(a * 12.9898 + b * 78.233 + salt * 37.719) * 43758.5453
  return s - Math.floor(s)
}

type Kind = 'grass' | 'paving' | 'asphalt' | 'rubber' | 'ground' | 'plaza'

/** Плитка фактуры: размер в метрах на один повтор. */
const TILE_M: Record<Kind, number> = {
  grass: 6,
  ground: 12,
  paving: 2,
  plaza: 3,
  asphalt: 5,
  rubber: 4,
}

function texture(kind: Kind): THREE.CanvasTexture {
  const n = 256
  const c = document.createElement('canvas')
  c.width = n
  c.height = n
  const g = c.getContext('2d')!
  const speckle = (colors: string[], count: number, size: number, salt: number): void => {
    for (let i = 0; i < count; i++) {
      g.fillStyle = colors[Math.floor(hash(i, salt) * colors.length)]!
      const x = hash(i, salt + 1) * n
      const y = hash(i, salt + 2) * n
      g.fillRect(x, y, size * (0.5 + hash(i, salt + 3)), size * (0.5 + hash(i, salt + 4)))
    }
  }
  switch (kind) {
    case 'grass':
    case 'ground': {
      g.fillStyle = kind === 'grass' ? '#5d8f3c' : '#6f8450'
      g.fillRect(0, 0, n, n)
      speckle(['#4f7f31', '#6aa045', '#76a94e', '#4a742d', '#83b25a'], 2600, 3, 1)
      // Травинки — короткие штрихи разных оттенков.
      g.lineWidth = 1
      for (let i = 0; i < 900; i++) {
        g.strokeStyle = hash(i, 9) > 0.5 ? 'rgba(160,200,110,0.5)' : 'rgba(40,80,25,0.45)'
        const x = hash(i, 10) * n
        const y = hash(i, 11) * n
        g.beginPath()
        g.moveTo(x, y)
        g.lineTo(x + (hash(i, 12) - 0.5) * 3, y - 2 - hash(i, 13) * 4)
        g.stroke()
      }
      break
    }
    case 'paving':
    case 'plaza': {
      g.fillStyle = kind === 'paving' ? '#b9b4ab' : '#c8bfae'
      g.fillRect(0, 0, n, n)
      // Плитки 4×4 со швами и лёгкой разницей в тоне.
      const step = n / 4
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          const t = 0.9 + hash(i, j, 3) * 0.2
          g.fillStyle = `rgba(${Math.round(185 * t)},${Math.round(180 * t)},${Math.round(171 * t)},0.6)`
          g.fillRect(i * step + 2, j * step + 2, step - 4, step - 4)
        }
      g.strokeStyle = '#8f8a82'
      g.lineWidth = 3
      for (let i = 0; i <= 4; i++) {
        g.beginPath()
        g.moveTo(i * step, 0)
        g.lineTo(i * step, n)
        g.moveTo(0, i * step)
        g.lineTo(n, i * step)
        g.stroke()
      }
      speckle(['rgba(0,0,0,0.06)', 'rgba(255,255,255,0.08)'], 1500, 2, 5)
      break
    }
    case 'asphalt': {
      g.fillStyle = '#41454c'
      g.fillRect(0, 0, n, n)
      speckle(['#3a3e44', '#4b5058', '#363a40', '#555a62', '#2f3237'], 4000, 2, 7)
      break
    }
    case 'rubber': {
      g.fillStyle = '#b4573e'
      g.fillRect(0, 0, n, n)
      speckle(['#a64e37', '#c06246', '#9c4733'], 3000, 2, 8)
      break
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.repeat.set(1 / TILE_M[kind], 1 / TILE_M[kind])
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** Лента вдоль ломаной на высоте y: UV в метрах (вдоль, поперёк) — фактура не тянется. */
function strip(line: readonly Pt[], width: number, y: number): THREE.BufferGeometry {
  const pts = line.map((p) => new THREE.Vector2(p.x / 1000, -p.y / 1000))
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  let along = 0
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)]!
    const next = pts[Math.min(pts.length - 1, i + 1)]!
    const d = next.clone().sub(prev)
    if (d.lengthSq() < 1e-9) d.set(1, 0)
    d.normalize()
    const nrm = new THREE.Vector2(-d.y, d.x)
    if (i > 0) along += pts[i]!.distanceTo(pts[i - 1]!)
    const p = pts[i]!
    const l = p.clone().addScaledVector(nrm, width / 2)
    const r = p.clone().addScaledVector(nrm, -width / 2)
    pos.push(l.x, y, l.y, r.x, y, r.y)
    uv.push(along, width, along, 0)
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
  // Нормали вверх независимо от обхода; лицо — к небу.
  const nor = g.getAttribute('normal')
  for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0, 1, 0)
  fixFacing(g)
  return g
}

/** Треугольники лицом вверх (+Y): обход разворачиваем там, где он смотрит вниз. */
function fixFacing(g: THREE.BufferGeometry): void {
  const p = g.getAttribute('position')
  const index = g.getIndex()!
  const arr = index.array as Uint16Array | Uint32Array
  for (let i = 0; i < arr.length; i += 3) {
    const [a, b, c] = [arr[i]!, arr[i + 1]!, arr[i + 2]!]
    const ux = p.getX(b) - p.getX(a)
    const uz = p.getZ(b) - p.getZ(a)
    const vx = p.getX(c) - p.getX(a)
    const vz = p.getZ(c) - p.getZ(a)
    if (uz * vx - ux * vz < 0) {
      arr[i + 1] = c
      arr[i + 2] = b
    }
  }
  index.needsUpdate = true
}

/** Многоугольник (с дырами) на высоте y, UV — в метрах. */
function area(
  outer: readonly Pt[],
  holes: readonly (readonly Pt[])[],
  y: number,
): THREE.BufferGeometry {
  const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p.x / 1000, p.y / 1000)))
  for (const h of holes)
    shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x / 1000, p.y / 1000))))
  const g = new THREE.ShapeGeometry(shape)
  g.rotateX(-Math.PI / 2)
  g.translate(0, y, 0)
  // UV после поворота: (x, −z) — те же метры плана.
  const p = g.getAttribute('position')
  const uv = g.getAttribute('uv')
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), -p.getZ(i))
  return g
}

/**
 * Территория. `buildings` — контуры корпусов в мм кампуса: земля вокруг них вырезана, фонари
 * и скамейки внутрь корпусов не ставятся.
 */
export function buildSiteVisual(
  site: SitePlanDoc,
  buildings: readonly (readonly Pt[])[],
  extentM: number,
): SiteVisual {
  const group = new THREE.Group()
  const trash: { dispose: () => void }[] = []
  const keep = <T extends { dispose: () => void }>(x: T): T => {
    trash.push(x)
    return x
  }
  const mats = new Map<Kind, THREE.Material>()
  const mat = (kind: Kind): THREE.Material => {
    let m = mats.get(kind)
    if (!m) mats.set(kind, (m = keep(new THREE.MeshLambertMaterial({ map: keep(texture(kind)) }))))
    return m
  }
  const add = (g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(keep(g), m)
    group.add(mesh)
    return mesh
  }
  const insideBuilding = (x: number, y: number): boolean =>
    buildings.some(
      (ring) => pointInPolygon({ x: Math.round(x), y: Math.round(y) }, ring) !== 'outside',
    )
  const features = Object.values(site.features)

  // Земля до горизонта, с вырезами под корпуса.
  const R = Math.max(1500, extentM * 6) * 1000
  const c = site.boundary.length
    ? site.boundary.reduce(
        (s, p) => ({ x: s.x + p.x / site.boundary.length, y: s.y + p.y / site.boundary.length }),
        { x: 0, y: 0 },
      )
    : { x: 0, y: 0 }
  const square: Pt[] = [
    { x: c.x - R, y: c.y - R },
    { x: c.x + R, y: c.y - R },
    { x: c.x + R, y: c.y + R },
    { x: c.x - R, y: c.y + R },
  ]
  add(area(square, buildings, -0.03), mat('ground'))

  // Площадные: газон, парковка, спортплощадка, зона отдыха.
  const areaKind: Partial<Record<SiteFeature['type'], [Kind, number]>> = {
    lawn: ['grass', 0.0],
    parking: ['asphalt', 0.01],
    sport: ['rubber', 0.012],
    rest: ['plaza', 0.014],
  }
  for (const f of features) {
    if (!('polygon' in f)) continue
    const k = areaKind[f.type]
    if (k) add(area(f.polygon, [], k[1]), mat(k[0]))
  }

  // Дороги — асфальт с прерывистой осевой; дорожки — плитка с бордюрами по краям.
  const lineMat = keep(new THREE.MeshLambertMaterial({ color: '#e8e6df' }))
  const curbMat = keep(new THREE.MeshLambertMaterial({ color: '#c9c6bf' }))
  // Штрихи разметки и бордюры — одной геометрией на всё: десятки кусков, один draw call.
  const dashes: THREE.BufferGeometry[] = []
  const curbs: THREE.BufferGeometry[] = []
  for (const f of features) {
    if (f.type === 'road') {
      add(strip(f.line, f.widthMm / 1000, 0.016), mat('asphalt'))
      // Разметка: штрихи 3 м через 3 м по оси.
      for (let i = 0; i + 1 < f.line.length; i++) {
        const a = f.line[i]!
        const b = f.line[i + 1]!
        const len = Math.hypot(b.x - a.x, b.y - a.y) / 1000
        for (let s = 1.5; s + 3 < len; s += 6) {
          const k0 = s / len
          const k1 = (s + 3) / len
          const p = (k: number): Pt => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k })
          dashes.push(strip([p(k0), p(k1)], 0.14, 0.02))
        }
      }
    } else if (f.type === 'path') {
      const w = f.widthMm / 1000
      add(strip(f.line, w, 0.03), mat('paving'))
      // Бордюры: узкие светлые полосы по краям, чуть выше плитки.
      for (const sideSign of [-1, 1]) {
        const shifted = offsetLine(f.line, sideSign * (w / 2 + 0.06) * 1000)
        curbs.push(strip(shifted, 0.12, 0.08))
      }
    }
  }
  for (const [parts, m] of [
    [dashes, lineMat],
    [curbs, curbMat],
  ] as const) {
    if (!parts.length) continue
    const merged = mergeGeometries(parts)
    for (const g of parts) g.dispose()
    if (merged) add(merged, m)
  }

  // Деревья: ствол + крона. Лиственные — два «облака» листвы, хвойные — три яруса конусов.
  const trees = features.filter(
    (f): f is Extract<SiteFeature, { type: 'tree' }> => f.type === 'tree',
  )
  if (trees.length) {
    const trunkGeo = keep(new THREE.CylinderGeometry(0.12, 0.2, 1, 7))
    trunkGeo.translate(0, 0.5, 0)
    const trunkMat = keep(new THREE.MeshLambertMaterial({ color: '#6b4a32' }))
    const leafGeo = keep(new THREE.IcosahedronGeometry(1, 1))
    const coneGeo = keep(new THREE.ConeGeometry(1, 1, 9))
    const leafMat = keep(new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }))
    const decid = trees.filter((t) => t.variant !== 'conifer')
    const conif = trees.filter((t) => t.variant === 'conifer')
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length)
    const crowns = new THREE.InstancedMesh(leafGeo, leafMat, Math.max(1, decid.length * 2))
    const tiers = new THREE.InstancedMesh(coneGeo, leafMat, Math.max(1, conif.length * 3))
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const col = new THREE.Color()
    let ci = 0
    let ti = 0
    trees.forEach((t, i) => {
      const x = t.x / 1000
      const z = -t.y / 1000
      const k = 0.8 + hash(t.x, t.y) * 0.45
      const rot = hash(t.y, t.x, 2) * Math.PI * 2
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot)
      const conifer = t.variant === 'conifer'
      const trunkH = (conifer ? 1.2 : 2.4) * k
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(k, trunkH, k))
      trunks.setMatrixAt(i, m)
      if (!conifer) {
        // Две сферы листвы со сдвигом — крона неправильной формы.
        for (let j = 0; j < 2; j++) {
          const r = (j === 0 ? 2.1 : 1.5) * k
          const dx = j === 0 ? 0 : (hash(t.x, j, 4) - 0.5) * 1.6 * k
          const dz = j === 0 ? 0 : (hash(t.y, j, 5) - 0.5) * 1.6 * k
          const y = trunkH + (j === 0 ? 1.4 : 2.4) * k
          m.compose(new THREE.Vector3(x + dx, y, z + dz), q, new THREE.Vector3(r, r * 0.85, r))
          crowns.setMatrixAt(ci, m)
          col.setHSL(0.27 + hash(t.x, t.y, 6) * 0.06, 0.45, 0.28 + hash(t.y, t.x, 7) * 0.1)
          crowns.setColorAt(ci++, col)
        }
      } else {
        for (let j = 0; j < 3; j++) {
          const r = (1.8 - j * 0.45) * k
          const h = (2.6 - j * 0.4) * k
          const y = trunkH + j * 1.5 * k + h / 2
          m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(r, h, r))
          tiers.setMatrixAt(ti, m)
          col.setHSL(0.36 + hash(t.x, t.y, 8) * 0.04, 0.4, 0.2 + hash(t.y, t.x, 9) * 0.06)
          tiers.setColorAt(ti++, col)
        }
      }
    })
    crowns.count = ci
    tiers.count = ti
    for (const im of [trunks, crowns, tiers]) {
      im.instanceMatrix.needsUpdate = true
      if (im.instanceColor) im.instanceColor.needsUpdate = true
      keep({ dispose: () => im.dispose() })
      if (im.count > 0) group.add(im)
    }
  }

  // Фонари вдоль дорожек и дорог — через 22 м, попеременно по сторонам, не внутри корпусов.
  const lamps: { x: number; z: number }[] = []
  for (const f of features) {
    if (f.type !== 'path' && f.type !== 'road') continue
    const step = f.type === 'road' ? 30 : 22
    const off = f.widthMm / 1000 / 2 + 0.6
    let carry = step / 2
    let n = 0
    for (let i = 0; i + 1 < f.line.length; i++) {
      const a = f.line[i]!
      const b = f.line[i + 1]!
      const len = Math.hypot(b.x - a.x, b.y - a.y) / 1000
      if (len < 1e-3) continue
      const ux = (b.x - a.x) / 1000 / len
      const uy = (b.y - a.y) / 1000 / len
      let s = carry
      for (; s < len; s += step) {
        const side = n++ % 2 ? 1 : -1
        const px = a.x / 1000 + ux * s - uy * off * side
        const py = a.y / 1000 + uy * s + ux * off * side
        if (!insideBuilding(px * 1000, py * 1000)) lamps.push({ x: px, z: -py })
      }
      carry = s - len
    }
  }
  if (lamps.length) {
    const poleGeo = keep(new THREE.CylinderGeometry(0.05, 0.08, 4.6, 8))
    poleGeo.translate(0, 2.3, 0)
    const headGeo = keep(new THREE.SphereGeometry(0.22, 12, 8))
    headGeo.translate(0, 4.75, 0)
    const poles = new THREE.InstancedMesh(
      poleGeo,
      keep(new THREE.MeshLambertMaterial({ color: '#2f343b' })),
      lamps.length,
    )
    const heads = new THREE.InstancedMesh(
      headGeo,
      keep(new THREE.MeshBasicMaterial({ color: '#fff4d6' })),
      lamps.length,
    )
    const m = new THREE.Matrix4()
    lamps.forEach((l, i) => {
      m.makeTranslation(l.x, 0, l.z)
      poles.setMatrixAt(i, m)
      heads.setMatrixAt(i, m)
    })
    for (const im of [poles, heads]) {
      im.instanceMatrix.needsUpdate = true
      keep({ dispose: () => im.dispose() })
      group.add(im)
    }
  }

  // Скамейки в зонах отдыха: по кругу у центра площадки, лицом к центру.
  const benches: { x: number; z: number; rot: number }[] = []
  for (const f of features) {
    if (f.type !== 'rest') continue
    const cx = f.polygon.reduce((s, p) => s + p.x, 0) / f.polygon.length / 1000
    const cy = f.polygon.reduce((s, p) => s + p.y, 0) / f.polygon.length / 1000
    for (let j = 0; j < 4; j++) {
      const ang = (j / 4) * Math.PI * 2 + hash(cx, cy) * 0.5
      const px = cx + Math.cos(ang) * 3
      const py = cy + Math.sin(ang) * 3
      if (
        pointInPolygon({ x: Math.round(px * 1000), y: Math.round(py * 1000) }, f.polygon) !==
        'inside'
      )
        continue
      benches.push({ x: px, z: -py, rot: -ang + Math.PI / 2 })
    }
  }
  if (benches.length) {
    const wood = keep(new THREE.MeshLambertMaterial({ color: '#8a5a36' }))
    const metal = keep(new THREE.MeshLambertMaterial({ color: '#2f343b' }))
    const parts: [THREE.BufferGeometry, THREE.Material][] = []
    const seat = keep(new THREE.BoxGeometry(1.6, 0.06, 0.45))
    seat.translate(0, 0.45, 0)
    const back = keep(new THREE.BoxGeometry(1.6, 0.4, 0.05))
    back.translate(0, 0.72, -0.2)
    parts.push([seat, wood], [back, wood])
    // Ножки — две тонкие рамы: из одного бокса не сделать, поэтому две узкие копии.
    const leg = keep(new THREE.BoxGeometry(0.06, 0.45, 0.42))
    for (const dx of [-0.7, 0.7]) {
      const g = keep(leg.clone())
      g.translate(dx, 0.225, 0)
      parts.push([g, metal])
    }
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    for (const [geo, material] of parts) {
      const im = new THREE.InstancedMesh(geo, material, benches.length)
      benches.forEach((b, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot)
        m.compose(new THREE.Vector3(b.x, 0, b.z), q, new THREE.Vector3(1, 1, 1))
        im.setMatrixAt(i, m)
      })
      im.instanceMatrix.needsUpdate = true
      keep({ dispose: () => im.dispose() })
      group.add(im)
    }
  }

  // Ограда по границе территории: столбики через 2,5 м и две перекладины, у ворот — разрыв.
  const gates = features.filter(
    (f): f is Extract<SiteFeature, { type: 'gate' }> => f.type === 'gate',
  )
  if (site.boundary.length >= 3) {
    const metal = keep(new THREE.MeshLambertMaterial({ color: '#30353c' }))
    const posts: { x: number; z: number }[] = []
    const rails: THREE.BufferGeometry[] = []
    const ring = site.boundary
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!
      const b = ring[(i + 1) % ring.length]!
      const len = Math.hypot(b.x - a.x, b.y - a.y) / 1000
      if (len < 0.5) continue
      const ux = (b.x - a.x) / 1000 / len
      const uy = (b.y - a.y) / 1000 / len
      // Где на отрезке ворота: проекция и полуширина.
      const gaps = gates
        .map((g) => {
          const s = ((g.x - a.x) / 1000) * ux + ((g.y - a.y) / 1000) * uy
          const d = Math.abs(((g.x - a.x) / 1000) * -uy + ((g.y - a.y) / 1000) * ux)
          return d < 3 ? { from: s - g.widthMm / 2000, to: s + g.widthMm / 2000 } : null
        })
        .filter((x): x is { from: number; to: number } => !!x)
      const open = (s: number): boolean => gaps.some((g) => s > g.from && s < g.to)
      // Столбики через 2,5 м; перекладины — по непрерывным участкам между воротами.
      const steps = Math.max(1, Math.ceil(len / 2.5))
      let run: number[] = []
      const flush = (): void => {
        if (run.length >= 2) {
          const from = run[0]!
          const to = run[run.length - 1]!
          const mid = (from + to) / 2
          for (const h of [0.35, 1.3]) {
            const g = new THREE.BoxGeometry(to - from, 0.04, 0.04)
            g.rotateY(Math.atan2(uy, ux))
            g.translate(a.x / 1000 + ux * mid, h, -(a.y / 1000 + uy * mid))
            rails.push(g)
          }
        }
        run = []
      }
      for (let k = 0; k <= steps; k++) {
        const at = (len * k) / steps
        if (open(at)) {
          flush()
          continue
        }
        posts.push({ x: a.x / 1000 + ux * at, z: -(a.y / 1000 + uy * at) })
        run.push(at)
      }
      flush()
    }
    if (rails.length) {
      const merged = mergeGeometries(rails)
      for (const g of rails) g.dispose()
      if (merged) add(merged, metal)
    }
    if (posts.length) {
      const pg = keep(new THREE.BoxGeometry(0.06, 1.5, 0.06))
      pg.translate(0, 0.75, 0)
      const im = new THREE.InstancedMesh(pg, metal, posts.length)
      const m = new THREE.Matrix4()
      posts.forEach((p, i) => {
        m.makeTranslation(p.x, 0, p.z)
        im.setMatrixAt(i, m)
      })
      im.instanceMatrix.needsUpdate = true
      keep({ dispose: () => im.dispose() })
      group.add(im)
    }
  }

  // Ворота: два кирпичных столба, перекладина и табличка с названием с обеих сторон.
  for (const g of gates) {
    const dir = gateDirection(g, site)
    const half = g.widthMm / 2000
    const x = g.x / 1000
    const z = -g.y / 1000
    // Поворот вокруг вертикали, при котором ось X смотрит вдоль проёма (в сцене (x, −y)).
    const ang = Math.atan2(dir.y, dir.x)
    const brick = keep(new THREE.MeshLambertMaterial({ color: '#9b4f3a' }))
    for (const sgn of [-1, 1]) {
      const p = keep(new THREE.BoxGeometry(0.5, 2.8, 0.5))
      p.translate(0, 1.4, 0)
      const mesh = add(p, brick)
      mesh.position.set(x + dir.x * (half + 0.25) * sgn, 0, z - dir.y * (half + 0.25) * sgn)
    }
    const beam = keep(new THREE.BoxGeometry(g.widthMm / 1000 + 1, 0.35, 0.3))
    beam.rotateY(ang)
    beam.translate(x, 2.95, z)
    add(beam, keep(new THREE.MeshLambertMaterial({ color: '#30353c' })))
    if (g.name) {
      const sign = signTexture(g.name)
      keep(sign)
      const w = Math.min(g.widthMm / 1000 + 0.6, 6)
      for (const sgn of [-1, 1]) {
        const plane = keep(new THREE.PlaneGeometry(w, w / 6))
        const mesh = add(plane, keep(new THREE.MeshBasicMaterial({ map: sign })))
        mesh.rotation.y = ang + (sgn > 0 ? 0 : Math.PI)
        // Лицом наружу с каждой стороны перекладины: нормаль плоскости после поворота.
        const nx = dir.y
        const nz = dir.x
        mesh.position.set(x + nx * 0.16 * sgn, 2.95, z + nz * 0.16 * sgn)
      }
    }
  }

  return {
    group,
    dispose: () => {
      group.removeFromParent()
      for (const t of trash) t.dispose()
    },
  }
}

/** Ломаная, сдвинутая вбок на `off` мм (для бордюров). */
function offsetLine(line: readonly Pt[], off: number): Pt[] {
  return line.map((p, i) => {
    const prev = line[Math.max(0, i - 1)]!
    const next = line[Math.min(line.length - 1, i + 1)]!
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    return { x: p.x - (dy / len) * off, y: p.y + (dx / len) * off }
  })
}

/** Ось проёма ворот в плане: вдоль ближайшей стороны границы, иначе поперёк ближайшей дорожки. */
function gateDirection(g: { x: number; y: number }, site: SitePlanDoc): { x: number; y: number } {
  let best: { d: number; x: number; y: number } | null = null
  const consider = (a: Pt, b: Pt, across: boolean): void => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    if (!len2) return
    const t = Math.max(0, Math.min(1, ((g.x - a.x) * dx + (g.y - a.y) * dy) / len2))
    const d = Math.hypot(g.x - (a.x + dx * t), g.y - (a.y + dy * t))
    const len = Math.sqrt(len2)
    const dir = across ? { x: -dy / len, y: dx / len } : { x: dx / len, y: dy / len }
    if (!best || d < best.d) best = { d, ...dir }
  }
  const ring = site.boundary
  for (let i = 0; i < ring.length; i++) consider(ring[i]!, ring[(i + 1) % ring.length]!, false)
  if (!best || (best as { d: number }).d > 5000) {
    best = null
    for (const f of Object.values(site.features)) {
      if (f.type !== 'path' && f.type !== 'road') continue
      for (let i = 0; i + 1 < f.line.length; i++) consider(f.line[i]!, f.line[i + 1]!, true)
    }
  }
  const b = best as { x: number; y: number } | null
  return b ? { x: b.x, y: b.y } : { x: 1, y: 0 }
}

function signTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 768
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#1f2a37'
  g.fillRect(0, 0, c.width, c.height)
  g.strokeStyle = '#d4af37'
  g.lineWidth = 6
  g.strokeRect(6, 6, c.width - 12, c.height - 12)
  g.fillStyle = '#ffffff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  let size = 64
  g.font = `bold ${size}px system-ui, sans-serif`
  while (size > 24 && g.measureText(text).width > c.width - 60) {
    size -= 4
    g.font = `bold ${size}px system-ui, sans-serif`
  }
  g.fillText(text, c.width / 2, c.height / 2 + 2)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
