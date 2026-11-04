'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import earcut from 'earcut'
import { generateCampus, type FloorPlanDoc } from '@studenthub/campus-core'

interface Stats {
  buildings: number
  floors: number
  walls: number
  generateMs: number
  meshMs: number
  triangles: number
  drawCalls: number
  geometriesMb: number
  fps: number | null
}

const FLOOR_H = 3.3
const WALL_H = 3.0

/** Стены этажа — коробки без сопряжений, одной геометрией (batching по этажу). */
function wallsGeometry(
  doc: FloorPlanDoc,
  elevation: number,
  ox: number,
  oz: number,
): THREE.BufferGeometry {
  const walls = Object.values(doc.walls)
  const pos = new Float32Array(walls.length * 20 * 3)
  const nor = new Float32Array(walls.length * 20 * 3)
  const idx = new Uint32Array(walls.length * 30)
  let v = 0
  let k = 0
  const quad = (p: number[][], n: number[]): void => {
    const base = v
    for (const q of p) {
      pos.set(q, v * 3)
      nor.set(n, v * 3)
      v++
    }
    idx.set([base, base + 1, base + 2, base, base + 2, base + 3], k)
    k += 6
  }
  for (const w of walls) {
    const a = doc.nodes[w.a]!
    const b = doc.nodes[w.b]!
    const ax = a.x / 1000 + ox
    const az = -a.y / 1000 + oz
    const bx = b.x / 1000 + ox
    const bz = -b.y / 1000 + oz
    const len = Math.hypot(bx - ax, bz - az) || 1
    const ux = (bx - ax) / len
    const uz = (bz - az) / len
    const t = w.thicknessMm / 2000
    const nx = -uz * t
    const nz = ux * t
    const y0 = elevation
    const y1 = elevation + WALL_H
    const A1 = [ax + nx, y0, az + nz]
    const A2 = [ax - nx, y0, az - nz]
    const B1 = [bx + nx, y0, bz + nz]
    const B2 = [bx - nx, y0, bz - nz]
    const up = (p: number[]): number[] => [p[0]!, y1, p[2]!]
    quad([A1, B1, up(B1), up(A1)], [-uz, 0, ux])
    quad([B2, A2, up(A2), up(B2)], [uz, 0, -ux])
    quad([up(A1), up(B1), up(B2), up(A2)], [0, 1, 0])
    quad([A2, A1, up(A1), up(A2)], [-ux, 0, -uz])
    quad([B1, B2, up(B2), up(B1)], [ux, 0, uz])
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  g.computeBoundingSphere()
  return g
}

/** Перекрытие — earcut по контуру корпуса. */
function slabGeometry(
  outline: { x: number; y: number }[],
  elevation: number,
  ox: number,
  oz: number,
): THREE.BufferGeometry {
  const flat = outline.flatMap((p) => [p.x / 1000 + ox, -p.y / 1000 + oz])
  const tris = earcut(flat)
  const pos = new Float32Array(outline.length * 3)
  outline.forEach((p, i) => pos.set([p.x / 1000 + ox, elevation, -p.y / 1000 + oz], i * 3))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setIndex(tris.reverse())
  g.computeVertexNormals()
  return g
}

export function CampusSpike() {
  const host = useRef<HTMLDivElement>(null)
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const q = new URLSearchParams(window.location.search)
    const b = Number(q.get('b') ?? 1)
    const f = Number(q.get('f') ?? 3)
    const r = Number(q.get('r') ?? 20)

    let t = performance.now()
    const campus = generateCampus({ buildings: b, floors: f, roomsPerSide: r, seed: 1 })
    const generateMs = performance.now() - t

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setSize(el.clientWidth, el.clientHeight)
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#0f1115')
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.2)
    sun.position.set(80, 200, 60)
    scene.add(sun)
    const wallMat = new THREE.MeshLambertMaterial({ color: '#d7dbe2' })
    const slabMat = new THREE.MeshLambertMaterial({ color: '#7c8796', side: THREE.DoubleSide })

    t = performance.now()
    let walls = 0
    const geometries: THREE.BufferGeometry[] = []
    let bytes = 0
    for (const bld of campus.buildings) {
      const ox = bld.transform.x / 1000
      const oz = -bld.transform.y / 1000
      for (const floor of bld.floors) {
        const elev = (floor.level - 1) * FLOOR_H
        const wg = wallsGeometry(floor.doc, elev, ox, oz)
        const sg = slabGeometry(bld.outline, elev, ox, oz)
        walls += Object.keys(floor.doc.walls).length
        for (const g of [wg, sg]) {
          geometries.push(g)
          for (const a of Object.values(g.attributes))
            bytes += (a as THREE.BufferAttribute).array.byteLength
          bytes += g.index?.array.byteLength ?? 0
        }
        scene.add(new THREE.Mesh(wg, wallMat), new THREE.Mesh(sg, slabMat))
      }
    }
    const meshMs = performance.now() - t

    const box = new THREE.Box3().setFromObject(scene)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3()).length()
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.5, size * 4)
    camera.position.set(center.x + size * 0.6, center.y + size * 0.5, center.z + size * 0.6)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.copy(center)
    controls.maxPolarAngle = Math.PI * 0.47
    controls.update()

    // Замер fps: 5 секунд вращения камеры вокруг цели, кадр на каждый rAF.
    let frames = 0
    let raf = 0
    const started = performance.now()
    let fps: number | null = null
    const loop = (): void => {
      const elapsed = performance.now() - started
      const angle = elapsed / 2000
      camera.position.set(
        center.x + Math.cos(angle) * size * 0.8,
        center.y + size * 0.5,
        center.z + Math.sin(angle) * size * 0.8,
      )
      camera.lookAt(center)
      renderer.render(scene, camera)
      frames++
      if (elapsed < 5000) {
        raf = requestAnimationFrame(loop)
      } else {
        fps = Math.round((frames * 1000) / elapsed)
        const s: Stats = {
          buildings: b,
          floors: b * f,
          walls,
          generateMs: Math.round(generateMs),
          meshMs: Math.round(meshMs),
          triangles: renderer.info.render.triangles,
          drawCalls: renderer.info.render.calls,
          geometriesMb: Math.round((bytes / 1024 / 1024) * 10) / 10,
          fps,
        }
        setStats(s)
        ;(window as unknown as { __spike?: Stats }).__spike = s
        controls.addEventListener('change', () => renderer.render(scene, camera))
      }
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      controls.dispose()
      for (const g of geometries) g.dispose()
      wallMat.dispose()
      slabMat.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [])

  return (
    <div className="relative h-dvh w-full">
      <div ref={host} className="absolute inset-0" />
      <pre className="absolute top-3 left-3 rounded-lg bg-black/70 p-3 text-xs text-white">
        {stats ? JSON.stringify(stats, null, 2) : 'Замер 5 с…'}
      </pre>
    </div>
  )
}
