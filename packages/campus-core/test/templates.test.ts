import { describe, expect, it } from 'vitest'
import {
  addCorridorWithRooms,
  addRoomRect,
  addWall,
  buildFaces,
  floorFromOutline,
  hasErrors,
  matchSpaces,
  projectOnSegment,
  sequentialIds,
  splitSpaceIntoRooms,
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

describe('«Разбить на комнаты»', () => {
  // Корпус 30×12 м: полоса комнат снизу, коридор 2 м посередине.
  function strip(number = 'А101') {
    const ids = sequentialIds()
    let doc = floorFromOutline(
      [
        { x: 0, y: 0 },
        { x: 30000, y: 0 },
        { x: 30000, y: 12000 },
        { x: 0, y: 12000 },
      ],
      ids,
    )
    const wall = { thicknessMm: 200, kind: 'wall' as const }
    doc = addWall(doc, { x: 0, y: 5000 }, { x: 30000, y: 5000 }, wall, ids).doc
    doc = addWall(doc, { x: 0, y: 7000 }, { x: 30000, y: 7000 }, wall, ids).doc
    doc = {
      ...doc,
      spaces: {
        room: {
          label: { x: 15000, y: 2500 },
          edges: [],
          kind: 'office',
          visibility: 'public',
          number,
        },
        hall: { label: { x: 15000, y: 6000 }, edges: [], kind: 'corridor', visibility: 'public' },
      },
    }
    return { doc: matchSpaces(doc).doc, ids }
  }

  it('полоса — пять кабинетов подряд с номерами и дверью в коридор у каждого', () => {
    const { doc, ids } = strip()
    const r = splitSpaceIntoRooms(doc, 'room', { count: 5 }, undefined, ids)!
    const numbers = Object.values(r.doc.spaces)
      .map((s) => s.number)
      .filter(Boolean)
      .sort()
    expect(numbers).toEqual(['А101', 'А102', 'А103', 'А104', 'А105'])
    expect(r.doc.spaces.room?.number).toBe('А101')
    expect(Object.values(r.doc.openings).filter((o) => o.type === 'door')).toHaveLength(5)
    expect(hasErrors(validateFloor(r.doc))).toBe(false)
  })

  it('номера продолжают последнюю группу цифр с сохранением ширины и хвоста', () => {
    const numbersAfterSplit = (number: string): (string | undefined)[] => {
      const { doc, ids } = strip(number)
      const r = splitSpaceIntoRooms(doc, 'room', { count: 3 }, undefined, ids)!
      return Object.values(r.doc.spaces)
        .filter((s) => s.kind === 'office')
        .map((s) => s.number)
        .sort()
    }
    expect(numbersAfterSplit('А-09')).toEqual(['А-09', 'А-10', 'А-11'])
    expect(numbersAfterSplit('2-12б')).toEqual(['2-12б', '2-13б', '2-14б'])
    expect(numbersAfterSplit('Холл')).toEqual(['Холл', undefined, undefined])
    // Перенос строки перед цифрами — номера нет, как у прежней регулярки.
    expect(numbersAfterSplit('А\n101')).toEqual(['А\n101', undefined, undefined])
  })

  it('длинный номер без продолжения разбирается за линейное время', () => {
    // На такой строке регулярка `^(.*?)(\d+)(\D*)$` перебирала бы квадратично — секунды.
    const long = '0'.repeat(50_000) + '\n0'
    const { doc, ids } = strip(long)
    const started = performance.now()
    const r = splitSpaceIntoRooms(doc, 'room', { count: 3 }, undefined, ids)!
    expect(performance.now() - started).toBeLessThan(1000)
    expect(r.doc.spaces.room?.number).toBe(long)
  })

  it('наклонные стены: разрезы без хвостиков за контуром', () => {
    const ids = sequentialIds()
    let doc = floorFromOutline(
      [
        { x: 0, y: 0 },
        { x: 20000, y: 0 },
        { x: 17000, y: 6000 },
        { x: 2000, y: 6000 },
      ],
      ids,
    )
    doc = {
      ...doc,
      spaces: {
        s: { label: { x: 10000, y: 3000 }, edges: [], kind: 'office', visibility: 'public' },
      },
    }
    const r = splitSpaceIntoRooms(matchSpaces(doc).doc, 's', { count: 4 }, undefined, ids)!
    expect(Object.keys(r.doc.spaces)).toHaveLength(4)
    expect(validateFloor(r.doc)).toEqual([])
  })

  it('уже метра или помещения нет — делить нечего', () => {
    const { doc, ids } = strip()
    expect(splitSpaceIntoRooms(doc, 'room', { count: 40 }, undefined, ids)).toBeNull()
    expect(splitSpaceIntoRooms(doc, 'nope', { count: 2 }, undefined, ids)).toBeNull()
  })
})
