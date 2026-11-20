import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import { tabsStuck } from './chat-details-panel'

describe('tabsStuck', () => {
  it('вкладки прилипли, когда прокрутка дошла до их места', () => {
    expect(tabsStuck(0, 520)).toBe(false)
    expect(tabsStuck(400, 520)).toBe(false)
    expect(tabsStuck(520, 520)).toBe(true)
    expect(tabsStuck(900, 520)).toBe(true)
  })

  it('дробная прокрутка при масштабе экрана не мешает', () => {
    expect(tabsStuck(518.6, 520)).toBe(true)
  })

  it('вкладок ещё нет в разметке (нулевая позиция) — не прилипли', () => {
    expect(tabsStuck(0, 0)).toBe(false)
  })
})
