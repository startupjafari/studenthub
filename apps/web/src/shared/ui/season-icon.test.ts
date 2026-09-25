import { describe, expect, it } from 'vitest'
import { HOLIDAYS } from '../config/holidays'
import { SEASON_ICON, seasonIcon } from './season-icon'

// Иконка подбирается по id праздника, то есть из значения, а не из литерала в разметке —
// компилятор такую связь не проверяет. Сверяем в обе стороны: у каждого праздника иконка
// есть, и лишних в карте не осталось от удалённых дат.

describe('иконки праздников', () => {
  it('иконка есть у каждого праздника', () => {
    const missing = HOLIDAYS.filter((holiday) => !SEASON_ICON[holiday.id]).map((h) => h.id)
    expect(missing).toEqual([])
  })

  it('в карте нет иконок без праздника', () => {
    const ids = new Set(HOLIDAYS.map((holiday) => holiday.id))
    expect(Object.keys(SEASON_ICON).filter((id) => !ids.has(id))).toEqual([])
  })

  it('у разных праздников разные знаки — иначе иконка ничего не сообщает', () => {
    const used = Object.values(SEASON_ICON)
    expect(new Set(used).size).toBe(used.length)
  })

  it('незнакомая дата получает запасную иконку, а не падает', () => {
    expect(seasonIcon('нет-такого-праздника')).toBeTruthy()
  })
})
