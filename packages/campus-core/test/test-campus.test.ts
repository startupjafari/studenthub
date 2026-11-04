import { describe, expect, it } from 'vitest'
import { testCampus } from '../src/fixtures/test-campus.js'
import { SitePlanSchema } from '../src/format/site.js'
import { FloorPlanSchema } from '../src/format/schema.js'
import { validateFloor } from '../src/validate/floor.js'
import {
  buildNavGraph,
  indexGraph,
  routeBetweenSpaces,
  routeSteps,
  explainNoRoute,
} from '../src/nav/index.js'

describe('тестовый кампус (§22.1)', () => {
  const campus = testCampus()
  const floors = campus.buildings.flatMap((b) => {
    let elevation = 0
    return b.floors.map((f) => {
      const input = {
        floorId: `${b.code}${f.level}`,
        buildingId: b.code,
        elevationMm: elevation,
        doc: f.doc,
        transform: b.transform,
      }
      elevation += f.heightMm
      return input
    })
  })

  it('документы проходят схему и проверку без ошибок', () => {
    expect(SitePlanSchema.safeParse(campus.site).success).toBe(true)
    for (const f of floors) {
      expect(FloorPlanSchema.safeParse(f.doc).success).toBe(true)
      expect(validateFloor(f.doc).filter((p) => p.severity === 'error')).toEqual([])
    }
  })

  it('id помещений уникальны на весь кампус', () => {
    const ids = floors.flatMap((f) => Object.keys(f.doc.spaces))
    expect(new Set(ids).size).toBe(ids.length)
  })

  const index = indexGraph(buildNavGraph(floors, campus.site))

  it('из учебного корпуса в библиотеку — по аллее', () => {
    const route = routeBetweenSpaces(index, 's_А103', 's_В102')
    expect(route).not.toBeNull()
    const kinds = routeSteps(index, route!).map((s) => s.type)
    expect(kinds).toEqual(['start', 'exit', 'enter', 'arrive'])
  })

  it('на третий этаж без ступеней — лифтом', () => {
    const route = routeBetweenSpaces(index, 's_А103', 's_А303', { stepFree: true })
    expect(route).not.toBeNull()
    const vertical = routeSteps(index, route!).find((s) => s.type === 'vertical')
    expect(vertical).toMatchObject({ via: 'elevator', toFloor: 'А3' })
  })

  it('от главных ворот — по аллее в корпус и на этаж', () => {
    const route = routeBetweenSpaces(index, 'gate:gate', 's_А305')
    expect(route).not.toBeNull()
    const kinds = routeSteps(index, route!).map((s) => s.type)
    expect(kinds).toEqual(['start', 'enter', 'vertical', 'arrive'])
  })

  it('в Б без лифта без ступеней не подняться', () => {
    expect(routeBetweenSpaces(index, 's_Б103', 's_Б303', { stepFree: true })).toBeNull()
    expect(explainNoRoute(index, 's_Б103', 's_Б303', { stepFree: true })).toBe(
      'STEP_FREE_UNAVAILABLE',
    )
  })
})
