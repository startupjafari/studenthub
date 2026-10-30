import { deadlineLabel, localDateString, localDateTimeLabel, localDayRange } from './local-label'

describe('localDateTimeLabel', () => {
  const at = new Date('2026-10-02T04:00:00.000Z')

  it('время в поясе вуза, а не UTC', () => {
    expect(localDateTimeLabel(at, 'Asia/Almaty')).toBe('2026-10-02 09:00')
  })

  it('без пояса и с битым поясом — UTC', () => {
    expect(localDateTimeLabel(at, null)).toBe('2026-10-02 04:00')
    expect(localDateTimeLabel(at, 'Mars/Olympus')).toBe('2026-10-02 04:00')
  })
})

describe('localDayRange', () => {
  it('сутки по Алматы (+5): с 19:00 UTC накануне до 19:00 UTC', () => {
    // 02:00 по Алматы 2 октября = 21:00 UTC 1 октября.
    const at = new Date('2026-10-01T21:00:00.000Z')
    expect(localDateString(at, 'Asia/Almaty')).toBe('2026-10-02')
    const { start, end } = localDayRange(at, 'Asia/Almaty')
    expect(start.toISOString()).toBe('2026-10-01T19:00:00.000Z')
    expect(end.toISOString()).toBe('2026-10-02T19:00:00.000Z')
  })

  it('без пояса — сутки UTC', () => {
    const { start, end } = localDayRange(new Date('2026-10-02T12:00:00.000Z'), null)
    expect(start.toISOString()).toBe('2026-10-02T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-10-03T00:00:00.000Z')
  })
})

describe('deadlineLabel', () => {
  const at = new Date('2026-10-02T04:00:00.000Z')

  it('срок в письме — в поясе вуза и с подписью пояса', () => {
    const label = deadlineLabel(at, 'ru-RU', 'Asia/Almaty')
    expect(label).toContain('09:00')
    expect(label).toContain('GMT+5')
  })

  it('без пояса и с битым поясом — пояс платформы, а не UTC процесса', () => {
    expect(deadlineLabel(at, 'ru-RU', null)).toContain('09:00')
    expect(deadlineLabel(at, 'ru-RU', 'Mars/Olympus')).toContain('09:00')
  })
})
