import { describe, expect, it } from 'vitest'
import {
  addCorridorWithRooms,
  addRoomRect,
  buildFaces,
  floorFromOutline,
  hasErrors,
  projectOnSegment,
  sequentialIds,
  validateFloor,
} from '../src/index.js'

describe('шаблоны планировки', () => {
  it('комната прямоугольником внутри корпуса делит его грань', () => {
    const ids = sequentialIds()
    const base = floorFromOutline(
      [
        { x: 0, y: 0 },
        { x: 20000, y: 0 },
        { x: 20000, y: 10000 },
        { x: 0, y: 10000 },
      ],
      ids,
    )
    const { doc } = addRoomRect(base, 0, 0, 6000, 5000, undefined, ids)
    expect(buildFaces(doc).faces).toHaveLength(2)
    expect(hasErrors(validateFloor(doc))).toBe(false)
  })

  it('коридор с комнатами в корпусе 60×18 м: 10 + 10 комнат и коридор', () => {
    const ids = sequentialIds()
    const base = floorFromOutline(
      [
        { x: 0, y: 0 },
        { x: 60000, y: 0 },
        { x: 60000, y: 18000 },
        { x: 0, y: 18000 },
      ],
      ids,
    )
    const { doc } = addCorridorWithRooms(
      base,
      { x0: 0, y0: 0, x1: 60000, y1: 18000, corridorMm: 2400, roomWidthMm: 6000 },
      undefined,
      ids,
    )
    expect(buildFaces(doc).faces).toHaveLength(21)
    expect(hasErrors(validateFloor(doc))).toBe(false)
  })

  it('проекция точки на отрезок', () => {
    expect(projectOnSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({
      t: 0.5,
      point: { x: 5, y: 0 },
      distance: 3,
    })
    expect(projectOnSegment({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }).t).toBe(0)
  })
})
