import * as THREE from 'three'
import {
  buildFaces,
  faceContains,
  matchSpaces,
  toCampus,
  type PlanSpace,
  type SpaceKind,
} from '@studenthub/campus-core'
import type { SceneFloor } from './scene'

/**
 * Таблички у дверей (docs/CAMPUS_BUILDER.md §13): у каждой двери помещения — табличка на
 * стене со стороны прохода, рядом с дверью на высоте глаз: номер крупно, ниже название или
 * тип. Все надписи этажа — в одной текстуре-атласе и одной геометрии: этаж — один draw call.
 */

/** Проходы: табличку вешаем с их стороны и о них самих не пишем. */
const CIRCULATION: readonly SpaceKind[] = ['corridor', 'hall', 'elevator_hall', 'stairwell']

const SIGN_W = 0.34
const SIGN_H = 0.14
/** Центр таблички над полом, м. */
const SIGN_Y = 1.55
/** Отступ таблички от края дверного проёма вдоль стены, м. */
const SIGN_GAP = 0.12
/** Ячейка атласа, px. */
const CELL_W = 256
const CELL_H = 104
const ATLAS = 2048

export interface DoorSigns {
  group: THREE.Group
  dispose: () => void
}

interface Sign {
  /** Центр таблички (сцена, м), нормаль от стены наружу, ось вдоль стены. */
  at: THREE.Vector3
  normal: THREE.Vector3
  along: THREE.Vector3
  title: string
  subtitle: string
}

/** Таблички этажа; нет дверей с подписью — `null`. */
export function buildDoorSigns(
  floor: SceneFloor,
  kindLabel: (kind: SpaceKind) => string,
): DoorSigns | null {
  const doc = floor.doc
  const faces = buildFaces(doc).faces
  const { assignments } = matchSpaces(doc, {}, faces)
  const spaceByFace = new Map(Object.entries(assignments).map(([s, f]) => [f, s]))
  const spaceAt = (p: { x: number; y: number }): PlanSpace | null => {
    let best: { area: number; id: string } | null = null
    for (const f of faces) {
      if (!faceContains(f, p)) continue
      const id = spaceByFace.get(f.id)
      if (id && (!best || f.areaMm2 < best.area)) best = { area: f.areaMm2, id }
    }
    const s = best ? doc.spaces[best.id] : undefined
    return s && s.visibility !== 'hidden' ? s : null
  }
  const scene = (x: number, y: number, h: number): THREE.Vector3 => {
    const c = floor.transform ? toCampus({ x, y }, floor.transform) : { x, y }
    return new THREE.Vector3(c.x / 1000, floor.elevationMm / 1000 + h, -c.y / 1000)
  }

  const signs: Sign[] = []
  for (const o of Object.values(doc.openings)) {
    if (o.type !== 'door' || !o.wallId) continue
    const w = doc.walls[o.wallId]
    const a = w && doc.nodes[w.a]
    const b = w && doc.nodes[w.b]
    if (!w || !a || !b) continue
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 1) continue
    const ux = (b.x - a.x) / len
    const uy = (b.y - a.y) / len
    const nx = -uy
    const ny = ux
    const mid = o.offsetMm + o.widthMm / 2
    const off = w.thicknessMm / 2 + 300
    const side = (sign: number) => ({
      x: a.x + ux * mid + nx * off * sign,
      y: a.y + uy * mid + ny * off * sign,
    })
    const s1 = spaceAt(side(1))
    const s2 = spaceAt(side(-1))
    // Подписываем помещение, а табличку вешаем со стороны, откуда к нему подходят: из
    // прохода; дверь между двумя помещениями — со стороны большего (обычно это холл).
    const room1 = s1 && !CIRCULATION.includes(s1.kind) ? s1 : null
    const room2 = s2 && !CIRCULATION.includes(s2.kind) ? s2 : null
    let room: PlanSpace | null = null
    let from = 1
    if (room1 && !room2) [room, from] = [room1, -1]
    else if (room2 && !room1) [room, from] = [room2, 1]
    else if (room1 && room2) {
      const f1 = faces.find((f) => faceContains(f, side(1)))
      const f2 = faces.find((f) => faceContains(f, side(-1)))
      ;[room, from] = (f1?.areaMm2 ?? 0) >= (f2?.areaMm2 ?? 0) ? [room2, 1] : [room1, -1]
    }
    if (!room) continue
    // Заголовок — номер (или название, или тип), ниже — то, чего в заголовке ещё нет.
    const kind = kindLabel(room.kind)
    const title = room.number ?? room.name ?? kind
    const second = room.number ? (room.name ?? kind) : room.name ? kind : ''
    const subtitle = second.toLowerCase() === title.toLowerCase() ? '' : second
    // Рядом с дверью: со стороны, где стена продолжается дальше.
    const after = len - (o.offsetMm + o.widthMm)
    const dir = after >= o.offsetMm ? 1 : -1
    const edge = dir > 0 ? o.offsetMm + o.widthMm : o.offsetMm
    const along = edge + dir * (SIGN_GAP * 1000 + (SIGN_W * 1000) / 2)
    if (along < 0 || along > len) continue
    const face = w.thicknessMm / 2 + 8
    const px = a.x + ux * along + nx * face * from
    const py = a.y + uy * along + ny * face * from
    const at = scene(px, py, SIGN_Y)
    const tip = scene(px + nx * from, py + ny * from, SIGN_Y)
    const normal = tip.sub(at).normalize()
    const alongV = scene(px + ux, py + uy, SIGN_Y)
      .sub(at)
      .normalize()
    signs.push({ at, normal, along: alongV, title, subtitle })
  }
  if (signs.length === 0) return null

  // Атлас: ячейка на табличку; не влезли — остальные без таблички (этаж-гигант — редкость).
  const perRow = Math.floor(ATLAS / CELL_W)
  const rows = Math.min(Math.ceil(signs.length / perRow), Math.floor(ATLAS / CELL_H))
  const list = signs.slice(0, perRow * rows)
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS
  canvas.height = rows * CELL_H
  const g = canvas.getContext('2d')!
  list.forEach((s, i) => {
    const x = (i % perRow) * CELL_W
    const y = Math.floor(i / perRow) * CELL_H
    g.fillStyle = '#1f2a37'
    g.fillRect(x, y, CELL_W, CELL_H)
    g.strokeStyle = '#94a3b8'
    g.lineWidth = 4
    g.strokeRect(x + 3, y + 3, CELL_W - 6, CELL_H - 6)
    g.fillStyle = '#ffffff'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `bold ${s.subtitle ? 44 : 50}px system-ui, sans-serif`
    fit(g, s.title, CELL_W - 24)
    g.fillText(s.title, x + CELL_W / 2, y + (s.subtitle ? 38 : CELL_H / 2))
    if (s.subtitle) {
      g.fillStyle = '#cbd5e1'
      g.font = '24px system-ui, sans-serif'
      fit(g, s.subtitle, CELL_W - 24)
      g.fillText(s.subtitle, x + CELL_W / 2, y + 78)
    }
  })
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4

  // Одна геометрия на этаж: по квадрату на табличку, UV — в её ячейку.
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  list.forEach((s, i) => {
    const u0 = ((i % perRow) * CELL_W) / ATLAS
    const u1 = u0 + CELL_W / ATLAS
    const v1 = 1 - (Math.floor(i / perRow) * CELL_H) / canvas.height
    const v0 = v1 - CELL_H / canvas.height
    // Текст читается слева направо, глядя на табличку: «право» — вверх × нормаль.
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), s.normal).normalize()
    const hw = right.multiplyScalar(SIGN_W / 2)
    const hh = new THREE.Vector3(0, SIGN_H / 2, 0)
    const base = pos.length / 3
    for (const [p, u, v] of [
      [s.at.clone().sub(hw).sub(hh), u0, v0],
      [s.at.clone().add(hw).sub(hh), u1, v0],
      [s.at.clone().add(hw).add(hh), u1, v1],
      [s.at.clone().sub(hw).add(hh), u0, v1],
    ] as const) {
      pos.push(p.x, p.y, p.z)
      uv.push(u, v)
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.computeBoundingSphere()
  const mat = new THREE.MeshBasicMaterial({ map: tex })
  const group = new THREE.Group()
  group.add(new THREE.Mesh(geo, mat))
  return {
    group,
    dispose: () => {
      group.removeFromParent()
      geo.dispose()
      mat.dispose()
      tex.dispose()
    },
  }
}

/** Ужать шрифт, чтобы строка влезла в ширину. */
function fit(g: CanvasRenderingContext2D, text: string, max: number): void {
  let size = parseInt(g.font, 10)
  while (size > 12 && g.measureText(text).width > max) {
    size -= 2
    g.font = g.font.replace(/\d+px/, `${size}px`)
  }
}
