import { describe, expect, it } from 'vitest'
import { PlanBuilder, buildFaces, edgeCaseFixtures, faceContains } from '../src/index.js'

const fx = edgeCaseFixtures()
const areas = (doc = fx.box!) =>
  buildFaces(doc)
    .faces.map((f) => f.areaMm2)
    .sort((a, b) => a - b)

describe('грани — замкнутые области', () => {
  it('пустой этаж и одиночная стена — без граней', () => {
    expect(buildFaces(fx.empty!).faces).toEqual([])
    const single = buildFaces(fx.singleWall!)
    expect(single.faces).toEqual([])
    expect(single.outside).toHaveLength(1)
  })

  it('коробка — одна грань нужной площади', () => {
    expect(areas(fx.box)).toEqual([48_000_000])
  })

  it('перегородка делит коробку на две', () => {
    expect(areas(fx.boxWithPartition)).toEqual([48_000_000, 48_000_000])
    expect(areas(fx.twoRoomsSharedWall)).toEqual([48_000_000, 48_000_000])
  })

  it('комната в комнате: внутренняя — грань, у внешней она — дыра', () => {
    const { faces } = buildFaces(fx.roomInRoom!)
    const outer = faces.find((f) => f.holes.length === 1)!
    expect(outer.areaMm2).toBe(100_000_000 - 1_000_000)
    expect(faceContains(outer, { x: 4500, y: 4500 })).toBe(false)
    expect(faceContains(outer, { x: 1000, y: 1000 })).toBe(true)
    expect(faces.map((f) => f.areaMm2).sort((a, b) => a - b)).toEqual([1_000_000, 99_000_000])
  })

  it('«ус» внутри комнаты не делит её, но входит в её стены', () => {
    const doc = new PlanBuilder()
      .rect(0, 0, 6000, 6000)
      .wall({ x: 0, y: 3000 }, { x: 2000, y: 3000 }).doc
    const { faces } = buildFaces(doc)
    expect(faces).toHaveLength(1)
    expect(faces[0]!.areaMm2).toBe(36_000_000)
    expect(faces[0]!.wallIds).toHaveLength(6) // три целые стены, левая — двумя половинами, и «ус»
  })

  it('отдельно стоящая стена внутри комнаты — дыра нулевой площади', () => {
    const doc = new PlanBuilder()
      .rect(0, 0, 6000, 6000)
      .wall({ x: 2000, y: 3000 }, { x: 4000, y: 3000 }).doc
    const { faces } = buildFaces(doc)
    expect(faces).toHaveLength(1)
    expect(faces[0]!.holes).toHaveLength(1)
    expect(faces[0]!.holes[0]!.area2).toBe(0)
    expect(faces[0]!.areaMm2).toBe(36_000_000)
  })

  it('острые углы и крест дают ожидаемое число граней', () => {
    expect(buildFaces(fx.acuteAngles!).faces).toHaveLength(1)
    expect(buildFaces(fx.crossingWalls!).faces).toHaveLength(0)
    expect(buildFaces(fx.tJunction!).faces).toHaveLength(0)
  })

  it('id грани детерминирован для одного и того же документа', () => {
    const a = buildFaces(fx.boxWithPartition!).faces.map((f) => f.id)
    const b = buildFaces(fx.boxWithPartition!).faces.map((f) => f.id)
    expect(a).toEqual(b)
  })
})
