import { describe, expect, it } from 'vitest'
import { canCancelReturn } from './return-cancel'

// «Отменить возврат» предлагаем только у выдачи, закрытой возвратом не больше суток назад:
// дальше сервер всё равно ответит 409 returnWindow.

const NOW = new Date('2026-10-23T12:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

describe('canCancelReturn', () => {
  it('возвращена час назад — можно', () => {
    expect(canCancelReturn({ status: 'RETURNED', returnedAt: hoursAgo(1) }, NOW)).toBe(true)
  })

  it('ровно сутки — ещё можно, позже — нет', () => {
    expect(canCancelReturn({ status: 'RETURNED', returnedAt: hoursAgo(24) }, NOW)).toBe(true)
    expect(canCancelReturn({ status: 'RETURNED', returnedAt: hoursAgo(25) }, NOW)).toBe(false)
  })

  it('открытая, утерянная и отменённая выдача — не возврат', () => {
    expect(canCancelReturn({ status: 'OPEN', returnedAt: null }, NOW)).toBe(false)
    expect(canCancelReturn({ status: 'LOST', returnedAt: hoursAgo(1) }, NOW)).toBe(false)
    expect(canCancelReturn({ status: 'CANCELLED', returnedAt: null }, NOW)).toBe(false)
  })
})
