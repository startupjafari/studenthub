import { describe, expect, it } from 'vitest'
import { SEASON_IDS } from '@studenthub/shared-schemas'
import { HOLIDAYS, activeHoliday, activeSeason, holidaysOn } from './holidays'

// Справочник праздников проверяется по границам, а не «в середине»: ошибка в такой таблице
// выглядит как оформление, включившееся на день раньше или задержавшееся на день дольше,
// и в ручном тесте её не видно — до следующего года.

/** Все дни года в виде `YYYY-MM-DD`. */
function daysOf(year: number): string[] {
  const out: string[] = []
  const cursor = new Date(Date.UTC(year, 0, 1))
  while (cursor.getUTCFullYear() === year) {
    out.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

const idOn = (date: string): string | null => activeHoliday(date)?.id ?? null

describe('справочник праздников', () => {
  it('ключи уникальны', () => {
    const ids = HOLIDAYS.map((h) => h.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('даты в таблице записаны как MM-DD и существуют в календаре', () => {
    const valid = (monthDay: string) => /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(monthDay)
    for (const holiday of HOLIDAYS) {
      const { when } = holiday
      if (when.kind === 'fixed') {
        expect(valid(when.from), `${holiday.id}: from`).toBe(true)
        if (when.to) {
          expect(valid(when.to), `${holiday.id}: to`).toBe(true)
          expect(when.to >= when.from, `${holiday.id}: диапазон наоборот`).toBe(true)
        }
      }
      if (when.kind === 'lunar') {
        for (const [year, monthDay] of Object.entries(when.byYear)) {
          expect(valid(monthDay), `${holiday.id}: ${year}`).toBe(true)
        }
      }
    }
  })

  /**
   * Контракт платформы знает сезоны по именам (SEASON_IDS): из этого списка админ выбирает
   * принудительный сезон, по нему же сервер проверяет присланное. Разойтись со справочником
   * он не имеет права — иначе в мини-аппе появится сезон, которого веб не покажет, или
   * наоборот, праздник, который нельзя выбрать.
   */
  it('список сезонов в контракте совпадает с таблицей праздников', () => {
    const decorated = HOLIDAYS.filter((holiday) => holiday.decorated).map((holiday) => holiday.id)
    expect([...SEASON_IDS].sort()).toEqual(decorated.sort())
  })

  it('лунные праздники расписаны на текущий и следующий год', () => {
    const current = new Date().getUTCFullYear()
    for (const holiday of HOLIDAYS) {
      if (holiday.when.kind !== 'lunar') continue
      for (const year of [current, current + 1]) {
        expect(
          holiday.when.byYear[String(year)],
          `${holiday.id}: нет даты на ${year} — её объявляет ДУМК, таблицу надо продлить`,
        ).toBeTruthy()
      }
    }
  })
})

describe('праздник дня', () => {
  it('Наурыз — ровно три дня', () => {
    expect(idOn('2026-03-20')).not.toBe('nauryz')
    expect(idOn('2026-03-21')).toBe('nauryz')
    expect(idOn('2026-03-23')).toBe('nauryz')
    expect(idOn('2026-03-24')).toBeNull()
  })

  it('Новый год — 1–2 января, 31 декабря — предновогодний день', () => {
    expect(idOn('2026-01-01')).toBe('new-year')
    expect(idOn('2026-01-02')).toBe('new-year')
    expect(idOn('2026-01-03')).toBeNull()
    expect(idOn('2026-12-31')).toBe('new-year-eve')
  })

  it('лунные праздники привязаны к году, а не к числу', () => {
    expect(idOn('2026-05-27')).toBe('kurban-ait')
    expect(idOn('2027-05-27')).toBeNull()
    expect(idOn('2027-05-16')).toBe('kurban-ait')
    // Ораза айт 2026 приходится на канун Наурыза — два праздника подряд, не один.
    expect(idOn('2026-03-20')).toBe('oraza-ait')
  })

  it('День учителя — первое воскресенье октября', () => {
    expect(idOn('2026-10-04')).toBe('teachers-day')
    expect(idOn('2026-10-05')).toBeNull()
    expect(idOn('2027-10-03')).toBe('teachers-day')
  })

  it('обычный день праздника не имеет', () => {
    expect(idOn('2026-09-25')).toBeNull()
    expect(activeSeason('2026-09-25')).toBeNull()
  })
})

describe('оформление дня', () => {
  it('день памяти не оформляется', () => {
    expect(idOn('2026-05-31')).toBe('repression-victims-day')
    expect(activeSeason('2026-05-31')).toBeNull()
  })

  it('выключенный мягкий праздник не оформляется, но известен', () => {
    expect(idOn('2026-10-31')).toBe('halloween')
    expect(activeSeason('2026-10-31')).toBeNull()
  })

  it('9 мая оформляется сдержанно — тоном, а не палитрой', () => {
    expect(activeSeason('2026-05-09')?.tone).toBe('solemn')
  })

  it('на любой день года побеждает старший праздник, и он ровно один', () => {
    for (const year of [2026, 2027]) {
      for (const date of daysOf(year)) {
        const all = holidaysOn(date)
        const winner = activeHoliday(date)
        if (all.length === 0) {
          expect(winner, date).toBeNull()
          continue
        }
        expect(all, date).toContain(winner)
        // День памяти обязан выигрывать у любого соседа по дате — иначе интерфейс
        // поздравит в день траура.
        if (all.some((h) => h.tier === 'MEMORIAL')) {
          expect(winner?.tier, date).toBe('MEMORIAL')
        }
      }
    }
  })
})
