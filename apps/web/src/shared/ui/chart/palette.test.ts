import { describe, expect, it } from 'vitest'
import { chartPalette, sequentialStep } from './palette'

// Палитра прогнана валидатором палитры (dataviz) против поверхностей карточек
// StudentHub. Тесты держат инварианты, которые легко сломать правкой «на глаз»:
// порядок слотов, монотонность шкалы, отсутствие пересечений со статусами.

describe('chartPalette', () => {
  it('у светлой и тёмной темы разные шаги серий', () => {
    const light = chartPalette(false)
    const dark = chartPalette(true)
    // Тёмные шаги подобраны под тёмную поверхность, а не получены инверсией светлых.
    expect(light.series).not.toEqual(dark.series)
    expect(light.surface).not.toEqual(dark.surface)
  })

  it('порядок категориальных слотов фиксирован', () => {
    // Порядок — механизм CVD-безопасности: менять только с повторным прогоном валидатора.
    expect(chartPalette(false).series).toEqual(['#2a78d6', '#eb6834', '#1baf7a'])
    expect(chartPalette(true).series).toEqual(['#3987e5', '#d95926', '#199e70'])
  })

  it('статусные цвета не темизируются и не совпадают с сериями', () => {
    const light = chartPalette(false)
    const dark = chartPalette(true)
    expect(light.status).toEqual(dark.status)
    for (const status of Object.values(light.status)) {
      expect(light.series).not.toContain(status)
      expect(dark.series).not.toContain(status)
    }
  })

  it('последовательная шкала — один тон, без повторов шагов', () => {
    for (const dark of [false, true]) {
      const steps = chartPalette(dark).sequential
      expect(steps.length).toBeGreaterThanOrEqual(5)
      expect(new Set(steps).size).toBe(steps.length)
    }
  })
})

describe('sequentialStep', () => {
  it('ноль отдаёт приглушённый тон, а не первый шаг шкалы', () => {
    const p = chartPalette(false)
    // Пустая ячейка теплокарты не должна читаться как «мало, но есть».
    expect(sequentialStep(p, 0)).toBe(p.muted)
  })

  it('растёт по шкале вместе с долей', () => {
    const p = chartPalette(false)
    const low = p.sequential.indexOf(sequentialStep(p, 0.1))
    const mid = p.sequential.indexOf(sequentialStep(p, 0.5))
    const high = p.sequential.indexOf(sequentialStep(p, 1))
    expect(low).toBeLessThan(mid)
    expect(mid).toBeLessThan(high)
  })

  it('доля 1 и выше не выходит за границы массива', () => {
    const p = chartPalette(true)
    const last = p.sequential[p.sequential.length - 1]
    expect(sequentialStep(p, 1)).toBe(last)
    expect(sequentialStep(p, 5)).toBe(last)
  })
})
