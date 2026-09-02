// План вуза: от числа студентов зависит вся остальная генерация, поэтому проверяем
// границы диапазона, раскладку групп по годам набора и уникальность факультетов.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { universityRandom } from '../lib/rng.mjs'
import { ENROLLMENT_YEARS, GROUP_SIZE, planUniversity } from './20-structure.mjs'

const CONFIG = { studentsMin: 700, studentsMax: 1700 }

describe('planUniversity', () => {
  it('держит число студентов в заданном диапазоне на всех 100 вузах', () => {
    for (let i = 1; i <= 100; i += 1) {
      const plan = planUniversity(i, universityRandom(i), CONFIG)
      assert.ok(
        plan.students >= CONFIG.studentsMin && plan.students <= CONFIG.studentsMax + GROUP_SIZE,
        `вуз ${i}: ${plan.students} студентов вне диапазона`,
      )
    }
  })

  it('детерминирован: тот же индекс — тот же план', () => {
    const a = planUniversity(42, universityRandom(42), CONFIG)
    const b = planUniversity(42, universityRandom(42), CONFIG)
    assert.equal(a.students, b.students)
    assert.deepEqual(
      a.faculties.map((f) => f.template.code),
      b.faculties.map((f) => f.template.code),
    )
  })

  it('коды факультетов внутри вуза не повторяются', () => {
    for (let i = 1; i <= 100; i += 1) {
      const codes = planUniversity(i, universityRandom(i), CONFIG).faculties.map(
        (f) => f.template.code,
      )
      assert.equal(new Set(codes).size, codes.length, `вуз ${i}: дубль факультета`)
    }
  })

  it('группы есть на каждом курсе — иначе четвёртый курс пустой', () => {
    const plan = planUniversity(3, universityRandom(3), CONFIG)
    const years = new Set(plan.faculties.flatMap((f) => f.groups.map((g) => g.year)))
    assert.deepEqual([...years].sort(), [...ENROLLMENT_YEARS].sort())
  })

  it('преподавателей хватает на нагрузку, минимум пять на факультет', () => {
    const plan = planUniversity(5, universityRandom(5), CONFIG)
    for (const faculty of plan.faculties) {
      assert.ok(faculty.teacherCount >= 5)
      assert.ok(faculty.teacherCount >= faculty.groups.length, 'нагрузка не покрыта')
    }
  })

  it('маленький вуз получает не меньше четырёх факультетов и аудиторий по минимуму', () => {
    const plan = planUniversity(9, universityRandom(9), { studentsMin: 100, studentsMax: 100 })
    assert.ok(plan.faculties.length >= 4)
    assert.ok(plan.roomCount >= 12)
  })
})
