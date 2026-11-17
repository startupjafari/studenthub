import { describe, expect, it } from 'vitest'
import { messageRunPosition, RUN_GAP_MS } from './message-run'

const at = (min: number): string => new Date(Date.UTC(2026, 10, 17, 9, min)).toISOString()

function msg(id: string, senderId: string, min: number, systemType: string | null = null) {
  return { id, senderId, createdAt: at(min), systemType }
}

describe('messageRunPosition', () => {
  it('подряд идущие сообщения одного автора — одна серия', () => {
    const list = [msg('a', 'u1', 0), msg('b', 'u1', 1), msg('c', 'u1', 2)]
    expect(messageRunPosition(list, 0)).toEqual({ first: true, last: false, startId: undefined })
    expect(messageRunPosition(list, 1)).toEqual({ first: false, last: false, startId: undefined })
    // Начало серии знает только последний — к нему прилипает аватар.
    expect(messageRunPosition(list, 2)).toEqual({ first: false, last: true, startId: 'a' })
  })

  it('другой автор рвёт серию', () => {
    const list = [msg('a', 'u1', 0), msg('b', 'u2', 1)]
    expect(messageRunPosition(list, 0)).toMatchObject({ first: true, last: true })
    expect(messageRunPosition(list, 1)).toMatchObject({ first: true, last: true })
  })

  it('пауза дольше 10 минут рвёт серию', () => {
    expect(RUN_GAP_MS).toBe(10 * 60 * 1000)
    const list = [msg('a', 'u1', 0), msg('b', 'u1', 11)]
    expect(messageRunPosition(list, 1).first).toBe(true)
    const close = [msg('a', 'u1', 0), msg('b', 'u1', 10)]
    expect(messageRunPosition(close, 1).first).toBe(false)
  })

  it('служебное сообщение и разделитель «Непрочитанные» рвут серию', () => {
    const list = [msg('a', 'u1', 0), msg('s', 'u1', 1, 'member_added'), msg('b', 'u1', 2)]
    expect(messageRunPosition(list, 0).last).toBe(true)
    expect(messageRunPosition(list, 2).first).toBe(true)
    const unread = [msg('a', 'u1', 0), msg('b', 'u1', 1)]
    expect(messageRunPosition(unread, 1, 'b').first).toBe(true)
    expect(messageRunPosition(unread, 0, 'b').last).toBe(true)
  })
})
