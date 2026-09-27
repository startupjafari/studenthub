import { describe, expect, it } from 'vitest'
import { firstUnreadIndex, unreadAfter } from './read-tracking'

const ME = 'me'
const row = (senderId: string, minute: number) => ({
  senderId,
  createdAt: `2026-09-01T10:${String(minute).padStart(2, '0')}:00.000Z`,
})

describe('firstUnreadIndex', () => {
  it('отсчитывает с конца только чужие: свой ответ плашку не сдвигает', () => {
    // Трое написали, я ответил в конце — непрочитанных двое, и плашка перед первым из них.
    const list = [row('a', 1), row('b', 2), row('a', 3), row(ME, 4)]
    expect(firstUnreadIndex(list, 2, ME)).toBe(1)
  })

  it('нет непрочитанного — плашки нет', () => {
    expect(firstUnreadIndex([row('a', 1)], 0, ME)).toBeNull()
  })

  it('непрочитанного больше, чем загружено, — плашка на самом раннем загруженном', () => {
    expect(firstUnreadIndex([row('a', 1), row('b', 2)], 30, ME)).toBe(0)
  })

  it('в ленте одни свои — плашки нет, даже если сервер насчитал непрочитанное', () => {
    expect(firstUnreadIndex([row(ME, 1), row(ME, 2)], 3, ME)).toBeNull()
  })
})

describe('unreadAfter', () => {
  const list = [row('a', 1), row(ME, 2), row('b', 3), row('a', 4)]

  it('считает чужие сообщения новее отметки', () => {
    expect(unreadAfter(list, row('x', 2).createdAt, ME)).toBe(2)
  })

  it('пустая отметка — не прочитано ничего из загруженного', () => {
    expect(unreadAfter(list, '', ME)).toBe(3)
  })

  it('отметки нет — считать нечего', () => {
    expect(unreadAfter(list, null, ME)).toBe(0)
  })

  it('прочитано последнее — ноль', () => {
    expect(unreadAfter(list, row('x', 4).createdAt, ME)).toBe(0)
  })
})
