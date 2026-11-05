import { describe, expect, it } from 'vitest'
import {
  FloorPlanSchema,
  buildFaces,
  generateCampus,
  generateFloor,
  hasErrors,
  matchSpaces,
  validateFloor,
} from '../src/index.js'

describe('генератор тестового кампуса', () => {
  it('этаж коридорной системы: комнаты, коридор, двери, лестницы — без ошибок проверки', () => {
    const doc = generateFloor({ roomsPerSide: 10, buildingCode: 'А', level: 3 })
    expect(FloorPlanSchema.safeParse(doc).success).toBe(true)
    expect(hasErrors(validateFloor(doc, { floorHeightMm: 3300 }))).toBe(false)
    expect(buildFaces(doc).faces).toHaveLength(21) // 10 + 10 комнат и коридор
    expect(Object.keys(doc.openings)).toHaveLength(21) // по двери на комнату и вход
    expect(Object.keys(doc.verticals)).toHaveLength(2)
    const kinds = Object.values(doc.spaces).map((s) => s.kind)
    expect(kinds.filter((k) => k === 'stairwell')).toHaveLength(2)
    expect(kinds.filter((k) => k === 'corridor')).toHaveLength(1)
    expect(Object.values(doc.spaces).some((s) => s.number === 'А301')).toBe(true)
  })

  it('детерминирован: одинаковые параметры — одинаковый документ', () => {
    expect(JSON.stringify(generateFloor({ roomsPerSide: 6 }))).toBe(
      JSON.stringify(generateFloor({ roomsPerSide: 6 })),
    )
  })

  it('помещения сгенерированного этажа уже совпадают со своими гранями', () => {
    const doc = generateFloor({ roomsPerSide: 5 })
    const r = matchSpaces(doc)
    expect(r.lost).toEqual([])
    expect(r.unassignedFaces).toEqual([])
  })

  it('кампус: N корпусов × M этажей, связи с Room уникальны внутри этажа', () => {
    const campus = generateCampus({ buildings: 4, floors: 3, roomsPerSide: 8, seed: 42 })
    expect(campus.buildings).toHaveLength(4)
    for (const b of campus.buildings) {
      expect(b.floors).toHaveLength(3)
      for (const f of b.floors) expect(hasErrors(validateFloor(f.doc))).toBe(false)
    }
    expect(
      JSON.stringify(generateCampus({ buildings: 2, floors: 1, roomsPerSide: 4, seed: 7 })),
    ).toBe(JSON.stringify(generateCampus({ buildings: 2, floors: 1, roomsPerSide: 4, seed: 7 })))
  })
})
