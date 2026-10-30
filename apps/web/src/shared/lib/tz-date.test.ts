import { describe, expect, it } from 'vitest'
import { isoWeek, isoWeekParity } from './tz-date'

// Эталон ISO-недели, посчитанный другим путём — проходом по дням, а не формулой: неделя
// начинается в понедельник, а 1-я неделя года — та, чей понедельник попадает на 29.12…04.01.
// Совпадение с эталоном на всём диапазоне — страж от «почти правильных» формул: прежняя
// ошиблась на единицу в 1101 дне из 2557 за 2024–2030 и переворачивала чётность пар.
function referenceWeeks(from: Date, to: Date): Array<[Date, number]> {
  // 01.01.2024 — понедельник, с него и начинаем: первая же итерация откроет 1-ю неделю.
  const cursor = new Date(2024, 0, 1)
  let week = 0
  const out: Array<[Date, number]> = []
  while (cursor <= to) {
    if (cursor.getDay() === 1) {
      const m = cursor.getMonth()
      const d = cursor.getDate()
      week = (m === 11 && d >= 29) || (m === 0 && d <= 4) ? 1 : week + 1
    }
    if (cursor >= from) out.push([new Date(cursor), week])
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

describe('isoWeek / isoWeekParity', () => {
  it('совпадает с эталонной ISO-неделей каждый день 2024–2030', () => {
    const days = referenceWeeks(new Date(2024, 0, 1), new Date(2030, 11, 31))
    expect(days).toHaveLength(2557)
    const mismatches = days
      .filter(([d, week]) => isoWeek(d) !== week)
      .map(([d, week]) => `${ymd(d)}: ${isoWeek(d)} вместо ${week}`)
    expect(mismatches).toEqual([])
    for (const [d, week] of days) {
      expect(isoWeekParity(d)).toBe(week % 2 === 1 ? 'ODD' : 'EVEN')
    }
  })

  it.each([
    // 23.10.2026 — пятница 43-й недели: нечётная (прежняя формула давала 42 → EVEN).
    [new Date(2026, 9, 23), 43, 'ODD'],
    [new Date(2026, 9, 19), 43, 'ODD'],
    [new Date(2026, 9, 25), 43, 'ODD'],
    [new Date(2026, 9, 26), 44, 'EVEN'],
    // Конец декабря уже относится к 1-й неделе следующего года.
    [new Date(2025, 11, 29), 1, 'ODD'],
    [new Date(2026, 0, 4), 1, 'ODD'],
    [new Date(2026, 0, 5), 2, 'EVEN'],
    // Начало января может ещё относиться к последней неделе прошлого года: в 2026-м их 53.
    [new Date(2026, 11, 31), 53, 'ODD'],
    [new Date(2027, 0, 3), 53, 'ODD'],
    [new Date(2027, 0, 4), 1, 'ODD'],
    [new Date(2024, 11, 30), 1, 'ODD'],
    [new Date(2021, 0, 3), 53, 'ODD'],
  ] as const)('%s → неделя %i, %s', (date, week, parity) => {
    expect(isoWeek(date)).toBe(week)
    expect(isoWeekParity(date)).toBe(parity)
  })

  it('время суток не влияет: считается по календарной дате', () => {
    expect(isoWeek(new Date(2026, 0, 4, 23, 59))).toBe(1)
    expect(isoWeek(new Date(2026, 0, 5, 0, 0))).toBe(2)
  })
})
