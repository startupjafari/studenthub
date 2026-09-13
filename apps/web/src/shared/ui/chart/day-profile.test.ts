import { describe, expect, it } from 'vitest'
import {
  DAY_GROUPS,
  HOUR_LABELS,
  averageDay,
  weekdayAverages,
  type DayHourGrid,
} from './day-profile'

/**
 * Сетка ответа: в каждый час дня недели `dow` за ВЕСЬ период попало `perHour[dow]`
 * событий (клетки — суммы, не средние), а самих таких дат в периоде — `days[dow]`.
 */
function grid(perHour: number[], days: number[]): DayHourGrid {
  return { cells: perHour.map((v) => Array.from({ length: 24 }, () => v)), days }
}

describe('averageDay', () => {
  it('делит на число дат, а не на число дней недели в группе', () => {
    // Будни: 20 событий в час на каждый из пяти дней, но дат — 20, а не 5.
    const data = grid([20, 20, 20, 20, 20, 4, 4], [4, 4, 4, 4, 4, 4, 4])
    const { days, hours } = averageDay(data, DAY_GROUPS[0].dows)
    expect(days).toBe(20)
    // 5 дней × 20 событий = 100 за час во все будни; на 20 дат — 5 за средние сутки.
    expect(hours[0]).toBe(5)
    expect(hours).toHaveLength(24)
  })

  it('группа без дат в периоде даёт нули, а не деление на ноль', () => {
    const data = grid([1, 1, 1, 1, 1, 0, 0], [1, 1, 1, 1, 1, 0, 0])
    const { days, hours } = averageDay(data, DAY_GROUPS[1].dows)
    expect(days).toBe(0)
    expect(hours.every((v) => v === 0)).toBe(true)
  })

  it('без данных возвращает пустые сутки — панель рисуется на любом ответе', () => {
    const { days, hours } = averageDay(undefined, DAY_GROUPS[0].dows)
    expect(days).toBe(0)
    expect(hours).toEqual(Array.from({ length: 24 }, () => 0))
  })
})

describe('weekdayAverages', () => {
  it('сравнивает дни по средним суткам, а не по числу дат в окне', () => {
    // Активность одинаковая — 10 событий в час каждый день. Но понедельников в окне
    // пять, а остальных дней четыре, поэтому и сумма в клетке понедельника больше.
    const data = grid([50, 40, 40, 40, 40, 40, 40], [5, 4, 4, 4, 4, 4, 4])
    // Ряд обязан выйти ровным: 10 событий в час × 24 часа на каждый день недели.
    expect(weekdayAverages(data)).toEqual(Array.from({ length: 7 }, () => 240))
  })

  it('день без дат не выпадает из ряда — его место занимает ноль', () => {
    const data = grid([10, 10, 10, 10, 10, 10, 10], [1, 1, 1, 1, 1, 0, 1])
    expect(weekdayAverages(data)[5]).toBe(0)
    expect(weekdayAverages(data)).toHaveLength(7)
  })
})

describe('HOUR_LABELS', () => {
  it('час подписан целиком — подсказка читается без оси', () => {
    expect(HOUR_LABELS).toHaveLength(24)
    expect(HOUR_LABELS[0]).toBe('00:00')
    expect(HOUR_LABELS[9]).toBe('09:00')
    expect(HOUR_LABELS[23]).toBe('23:00')
  })
})
