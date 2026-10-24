import { addDays, daysBetween, endOfDay, formatDay, todayIn } from './library-dates'

describe('даты библиотеки', () => {
  it('срок — последний момент дня по часам вуза', () => {
    // Алматы UTC+5: конец 22.10 по местному — 18:59:59.999 UTC.
    expect(endOfDay('2026-10-22', 'Asia/Almaty').toISOString()).toBe('2026-10-22T18:59:59.999Z')
    // Пояс дальше +12: полдень UTC здесь уже следующие сутки — день не должен съехать.
    expect(endOfDay('2026-10-22', 'Pacific/Kiritimati').toISOString()).toBe(
      '2026-10-22T09:59:59.999Z',
    )
    expect(endOfDay('2026-10-22', 'America/New_York').toISOString()).toBe(
      '2026-10-23T03:59:59.999Z',
    )
  })

  it('сегодня — по часам вуза, а не сервера', () => {
    // 21:00 UTC 22.10 — в Алматы уже 23.10.
    expect(todayIn('Asia/Almaty', new Date('2026-10-22T21:00:00Z'))).toBe('2026-10-23')
  })

  it('календарная арифметика переходит через месяц и год', () => {
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08')
    expect(daysBetween('2026-10-22', '2027-02-19')).toBe(120)
    expect(formatDay('2026-10-22')).toBe('22.10.2026')
  })
})
