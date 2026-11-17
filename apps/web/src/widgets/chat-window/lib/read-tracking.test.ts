import { describe, expect, it } from 'vitest'
import {
  OPEN_PAGE,
  firstUnreadIndex,
  firstUnreadPosition,
  needsWindow,
  openAnchor,
  unreadAfter,
  withReceipt,
} from './read-tracking'

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

describe('withReceipt', () => {
  const receipts = [
    { id: 'a', firstName: 'А', lastReadAt: '2026-09-01T10:00:00.000Z' },
    { id: 'b', firstName: 'Б', lastReadAt: null },
  ]

  it('двигает отметку участника вперёд, не трогая остальных', () => {
    const next = withReceipt(receipts, 'a', '2026-09-01T10:05:00.000Z')
    expect(next[0]).toEqual({ id: 'a', firstName: 'А', lastReadAt: '2026-09-01T10:05:00.000Z' })
    expect(next[1]).toBe(receipts[1])
  })

  it('первое прочтение — у кого отметки не было', () => {
    expect(withReceipt(receipts, 'b', '2026-09-01T10:01:00.000Z')[1]?.lastReadAt).toBe(
      '2026-09-01T10:01:00.000Z',
    )
  })

  it('запоздавшее более раннее прочтение отметку не откатывает — список тот же', () => {
    expect(withReceipt(receipts, 'a', '2026-09-01T09:00:00.000Z')).toBe(receipts)
  })

  it('незнакомый участник — список тот же', () => {
    expect(withReceipt(receipts, 'zzz', '2026-09-01T10:05:00.000Z')).toBe(receipts)
  })
})

describe('открытие чата на первом непрочитанном (P.8)', () => {
  const idRow = (id: string, senderId: string, minute: number) => ({ id, ...row(senderId, minute) })

  it('непрочитанных не меньше страницы — сразу окно вокруг первого', () => {
    expect(openAnchor({ unreadCount: OPEN_PAGE, firstUnreadId: 'm1' }, OPEN_PAGE)).toEqual({
      kind: 'around',
      messageId: 'm1',
    })
    expect(openAnchor({ unreadCount: 5, firstUnreadId: 'm1' }, OPEN_PAGE)).toEqual({
      kind: 'bottom',
    })
    // Старый сервер без firstUnreadId — как раньше, у низа.
    expect(openAnchor({ unreadCount: 99 }, OPEN_PAGE)).toEqual({ kind: 'bottom' })
    expect(openAnchor(undefined, OPEN_PAGE)).toEqual({ kind: 'bottom' })
  })

  it('первое непрочитанное не попало в последнюю страницу — нужно окно', () => {
    const items = [{ id: 'a' }, { id: 'b' }]
    expect(needsWindow({ items, hasNext: true }, 'x')).toBe(true)
    expect(needsWindow({ items, hasNext: true }, 'a')).toBe(false)
    // Истории старше нет — искать негде, первое непрочитанное и есть начало чата.
    expect(needsWindow({ items, hasNext: false }, 'x')).toBe(false)
    expect(needsWindow({ items, hasNext: true }, null)).toBe(false)
  })

  it('плашка — по id первого непрочитанного, без него — отсчётом с конца', () => {
    const list = [idRow('a', 'u2', 1), idRow('b', 'u2', 2), idRow('c', ME, 3), idRow('d', 'u2', 4)]
    expect(firstUnreadPosition(list, { unreadCount: 2, firstUnreadId: 'a' }, ME)).toBe(0)
    expect(firstUnreadPosition(list, { unreadCount: 2 }, ME)).toBe(1)
    // id есть, но в ленте его нет (окно не загрузилось) — отсчёт с конца.
    expect(firstUnreadPosition(list, { unreadCount: 1, firstUnreadId: 'zzz' }, ME)).toBe(3)
    expect(firstUnreadPosition(list, { unreadCount: 0, firstUnreadId: 'a' }, ME)).toBeNull()
  })
})
