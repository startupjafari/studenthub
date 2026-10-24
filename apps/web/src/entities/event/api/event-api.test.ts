import { describe, expect, it } from 'vitest'
import { eventKeys } from './event-api'

// E-F11 (регрессия, E-F27): виджет главной берёт 4 ближайших события, «Мероприятия» и
// календарь — 50. С общим ключом кэша экран, открытый следом за главной, показывал четыре.
describe('eventKeys.list', () => {
  it('разный limit — разные ключи кэша', () => {
    expect(eventKeys.list('upcoming', false, 4)).not.toEqual(eventKeys.list('upcoming'))
    expect(eventKeys.list('upcoming', false, 30)).not.toEqual(eventKeys.list('upcoming'))
  })

  it('без явного limit ключ один у «Мероприятий» и календаря', () => {
    expect(eventKeys.list('upcoming')).toEqual(eventKeys.list('upcoming', false))
  })

  it('ключи списков лежат под общим префиксом — инвалидация eventKeys.all их задевает', () => {
    expect(eventKeys.list('past', true).slice(0, 1)).toEqual(eventKeys.all)
  })
})
