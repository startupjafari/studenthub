// Календарь сида: какой семестр текущий и какой курс у набора — от даты прогона.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { academicCalendar, courseOf, enrollmentYears } from './calendar.mjs'

const at = (iso) => new Date(`${iso}T12:00:00Z`)

describe('academicCalendar', () => {
  it('осенью текущий — осенний семестр, прошлый — весна того же года', () => {
    const cal = academicCalendar(at('2026-10-24'))
    assert.equal(cal.cur.name, 'Осень 2026')
    assert.equal(cal.prev.name, 'Весна 2026')
    assert.equal(cal.academicYear, 2026)
    assert.equal(cal.scheduleName, 'Осенний семестр 2026/27')
  })

  // Прогон в марте не должен заводить активный семестр, который начнётся только в сентябре.
  it('весной текущий — весенний семестр, прошлый — осень прошлого года', () => {
    const cal = academicCalendar(at('2027-03-10'))
    assert.equal(cal.cur.name, 'Весна 2027')
    assert.equal(cal.cur.from, '2027-01-20')
    assert.equal(cal.prev.name, 'Осень 2026')
    assert.equal(cal.academicYear, 2026)
    assert.equal(cal.scheduleName, 'Весенний семестр 2026/27')
  })

  it('с августа текущим считается осенний семестр', () => {
    assert.equal(academicCalendar(at('2026-08-05')).cur.name, 'Осень 2026')
    assert.equal(academicCalendar(at('2026-07-31')).cur.name, 'Весна 2026')
  })
})

describe('courseOf и enrollmentYears', () => {
  it('набор прошлой осени весной ещё на первом курсе', () => {
    assert.equal(courseOf(2026, at('2027-03-10')), 1)
    assert.equal(courseOf(2026, at('2026-10-24')), 1)
    assert.equal(courseOf(2025, at('2026-10-24')), 2)
  })

  it('курс ограничен 1..4', () => {
    assert.equal(courseOf(2020, at('2026-10-24')), 4)
    assert.equal(courseOf(2030, at('2026-10-24')), 1)
  })

  it('годы набора — четыре курса текущего учебного года', () => {
    assert.deepEqual(enrollmentYears(at('2026-10-24')), [2023, 2024, 2025, 2026])
    assert.deepEqual(enrollmentYears(at('2027-03-10')), [2023, 2024, 2025, 2026])
  })
})
