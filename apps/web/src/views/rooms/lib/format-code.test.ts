import { describe, expect, it } from 'vitest'
import { formatRoomCode, isCompleteRoomCode, normalizeRoomCode } from './format-code'

describe('formatRoomCode', () => {
  it('делит восьмизначный код на две группы', () => {
    expect(formatRoomCode('ABCD2345')).toBe('ABCD-2345')
  })

  it('код другой длины не трогает', () => {
    expect(formatRoomCode('ABC')).toBe('ABC')
  })
})

describe('normalizeRoomCode', () => {
  it('поднимает регистр и снимает разделители, набранные с наклейки', () => {
    expect(normalizeRoomCode('abcd-2345')).toBe('ABCD2345')
    expect(normalizeRoomCode(' 23 45 AB CD ')).toBe('2345ABCD')
  })

  it('символы, которых в коде не бывает, отбрасываются как опечатка', () => {
    // 0/O, 1/I/L исключены из алфавита именно чтобы их не путали при переписывании.
    expect(normalizeRoomCode('OIL0123')).toBe('23')
  })

  it('обрезает лишнее — длиннее восьми код не бывает', () => {
    expect(normalizeRoomCode('ABCD2345XYZ')).toBe('ABCD2345')
  })
})

describe('isCompleteRoomCode', () => {
  it('полный код — восемь символов', () => {
    expect(isCompleteRoomCode('ABCD2345')).toBe(true)
    expect(isCompleteRoomCode('ABCD234')).toBe(false)
  })
})
